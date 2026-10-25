import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';

const RECOVERY_CODES = 10;
/** El desafío de inicio de sesión dura 5 minutos. */
const CHALLENGE_TTL = '5m';

interface TwoFactorChallenge {
  sub: string;
  purpose: '2fa-login';
}

interface TotpUser {
  id: string;
  totpSecret: string | null;
  totpLastTimeStep: number | null;
}

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/** Normaliza un código de respaldo: "abcd-efgh" → "ABCDEFGH". */
const normalizeRecovery = (code: string) =>
  code.replace(/[\s-]/g, '').toUpperCase();

/**
 * Verificación en dos pasos con app autenticadora (TOTP, RFC 6238) y 10
 * códigos de respaldo de un solo uso.
 *
 * - El secreto se guarda cifrado con AES-256-GCM (`TWO_FACTOR_KEY`).
 * - `setup` crea un secreto pendiente; `enable` lo activa al confirmar un código.
 * - Al iniciar sesión (contraseña o Google) con 2FA activa no se abre sesión:
 *   se entrega un desafío firmado de 5 min que se canjea con un código.
 */
@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
  ) {}

  /* ---------------------------- Cifrado ---------------------------- */

  private get key() {
    const raw =
      this.config.get<string>('twoFactor.encryptionKey') ??
      `2fa:${this.config.get<string>('jwt.secret')}`;
    return createHash('sha256').update(raw).digest();
  }

  private encrypt(plain: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data]
      .map((part) => part.toString('base64'))
      .join('.');
  }

  private decrypt(payload: string) {
    const [iv, tag, data] = payload
      .split('.')
      .map((part) => Buffer.from(part, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  }

  /* ----------------------------- Estado ----------------------------- */

  private findUser(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        passwordSetAt: true,
        totpSecret: true,
        totpEnabledAt: true,
        totpRecoveryCodes: true,
        totpLastTimeStep: true,
      },
    });
  }

  async status(userId: string) {
    const user = await this.findUser(userId);
    return {
      enabled: user.totpEnabledAt !== null,
      enabledAt: user.totpEnabledAt,
      recoveryCodesLeft: user.totpRecoveryCodes.length,
    };
  }

  async isEnabled(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpEnabledAt: true },
    });
    return Boolean(user?.totpEnabledAt);
  }

  /* --------------------------- Activación --------------------------- */

  /** Genera un secreto pendiente y su QR. Reemplaza uno pendiente anterior. */
  async setup(userId: string) {
    const user = await this.findUser(userId);
    if (user.totpEnabledAt)
      throw new ConflictException(
        'La verificación en dos pasos ya está activa.',
      );

    const secret = generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecret: this.encrypt(secret), totpLastTimeStep: null },
    });
    const otpauthUrl = generateURI({
      issuer: this.config.get<string>('twoFactor.issuer') ?? 'Zentro',
      label: user.email,
      secret,
    });
    return {
      secret,
      otpauthUrl,
      qrCode: await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 }),
    };
  }

  /** Confirma el primer código de la app, activa 2FA y entrega los códigos de respaldo. */
  async enable(userId: string, code: string) {
    const user = await this.findUser(userId);
    if (user.totpEnabledAt)
      throw new ConflictException(
        'La verificación en dos pasos ya está activa.',
      );
    if (!user.totpSecret)
      throw new BadRequestException('Primero genera el código QR.');
    if (!(await this.verifyTotp(user, code)))
      throw new BadRequestException(
        'El código no es correcto. Revisa la hora de tu celular.',
      );

    const recoveryCodes = this.newRecoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpEnabledAt: new Date(),
        totpRecoveryCodes: recoveryCodes.map((item) =>
          sha256(normalizeRecovery(item)),
        ),
      },
    });
    void this.mail.sendSecurityNotice(
      user.email,
      user.name,
      'Activaste la verificación en dos pasos',
      'Desde ahora te pediremos un código de tu app autenticadora al iniciar sesión.',
    );
    return { recoveryCodes };
  }

  /** Desactiva 2FA. Pide la contraseña (si la cuenta tiene) y un código válido. */
  async disable(userId: string, code: string, password?: string) {
    const user = await this.findUser(userId);
    if (!user.totpEnabledAt)
      throw new BadRequestException(
        'La verificación en dos pasos no está activa.',
      );
    if (user.passwordSetAt) {
      const ok = password && (await bcrypt.compare(password, user.password));
      if (!ok) throw new BadRequestException('La contraseña es incorrecta.');
    }
    if (!(await this.checkCode(user, code)))
      throw new BadRequestException('El código no es correcto.');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpSecret: null,
        totpEnabledAt: null,
        totpRecoveryCodes: [],
        totpLastTimeStep: null,
      },
    });
    void this.mail.sendSecurityNotice(
      user.email,
      user.name,
      'Desactivaste la verificación en dos pasos',
      'Tu cuenta ya no pide un código de la app al iniciar sesión.',
    );
  }

  /** Genera códigos de respaldo nuevos (invalida los anteriores). */
  async regenerateRecoveryCodes(userId: string, code: string) {
    const user = await this.findUser(userId);
    if (!user.totpEnabledAt || !user.totpSecret)
      throw new BadRequestException(
        'La verificación en dos pasos no está activa.',
      );
    if (!(await this.verifyTotp(user, code)))
      throw new BadRequestException('El código no es correcto.');

    const recoveryCodes = this.newRecoveryCodes();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        totpRecoveryCodes: recoveryCodes.map((item) =>
          sha256(normalizeRecovery(item)),
        ),
      },
    });
    return { recoveryCodes };
  }

  /* ------------------------- Inicio de sesión ------------------------- */

  createChallenge(userId: string) {
    const payload: TwoFactorChallenge = { sub: userId, purpose: '2fa-login' };
    return this.jwt.sign(payload, {
      secret: this.config.get<string>('jwt.secret'),
      expiresIn: CHALLENGE_TTL,
    });
  }

  /** Canjea el desafío con un código de la app o de respaldo. Devuelve el usuario. */
  async completeChallenge(challenge: string, code: string) {
    let userId: string;
    try {
      const payload = this.jwt.verify<TwoFactorChallenge>(challenge, {
        secret: this.config.get<string>('jwt.secret'),
      });
      if (payload.purpose !== '2fa-login') throw new Error();
      userId = payload.sub;
    } catch {
      throw new UnauthorizedException(
        'La verificación expiró. Vuelve a iniciar sesión.',
      );
    }
    const user = await this.findUser(userId);
    if (!user.totpEnabledAt || !(await this.checkCode(user, code)))
      throw new BadRequestException('El código no es correcto.');
    return { id: user.id, email: user.email };
  }

  /* ----------------------------- Códigos ----------------------------- */

  /**
   * Valida un código de la app y lo "quema": guarda su periodo para que el
   * mismo código no sirva otra vez dentro de sus 30 s (ataque de repetición).
   */
  private async verifyTotp(user: TotpUser, code: string) {
    if (!user.totpSecret || !/^\d{6}$/.test(code)) return false;
    try {
      const result = await verify({
        secret: this.decrypt(user.totpSecret),
        token: code,
        // Tolera ±30 s de desfase con el reloj del celular.
        epochTolerance: 30,
        ...(user.totpLastTimeStep !== null
          ? { afterTimeStep: user.totpLastTimeStep }
          : {}),
      });
      if (!result.valid) return false;
      // El tipo es la unión HOTP/TOTP; en TOTP siempre viene `timeStep`.
      const timeStep =
        'timeStep' in result
          ? (result as { timeStep: number }).timeStep
          : Math.floor(Date.now() / 30_000) + result.delta;
      // Condición atómica: si otra petición usó este periodo a la vez, solo una gana.
      const saved = await this.prisma.user.updateMany({
        where: {
          id: user.id,
          OR: [
            { totpLastTimeStep: null },
            { totpLastTimeStep: { lt: timeStep } },
          ],
        },
        data: { totpLastTimeStep: timeStep },
      });
      return saved.count === 1;
    } catch {
      return false;
    }
  }

  /** Código de la app (6 dígitos) o de respaldo (se consume al usarlo). */
  private async checkCode(
    user: TotpUser & { totpRecoveryCodes: string[] },
    code: string,
  ) {
    const trimmed = code.trim();
    if (await this.verifyTotp(user, trimmed)) return true;

    const hash = sha256(normalizeRecovery(trimmed));
    if (!user.totpRecoveryCodes.includes(hash)) return false;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        totpRecoveryCodes: user.totpRecoveryCodes.filter(
          (item) => item !== hash,
        ),
      },
    });
    return true;
  }

  /** 10 códigos tipo "K7QM-2XPA" (sin caracteres ambiguos). */
  private newRecoveryCodes() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: RECOVERY_CODES }, () => {
      const chars = Array.from(
        randomBytes(8),
        (byte) => alphabet[byte % alphabet.length],
      );
      return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
    });
  }
}
