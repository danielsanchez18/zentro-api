import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { OAuthProfile, OAuthProvider } from './oauth.types';

/**
 * Vínculo pendiente: alguien entró con Google usando el correo de una cuenta
 * que ya existe y aún no tiene Google. No se vincula solo; el frontend muestra
 * la pantalla "Confirma que eres tú" y la persona prueba que es dueña de la
 * cuenta con su contraseña o con un código enviado al correo (10 min).
 */
interface PendingLink {
  purpose: 'oauth-pending-link';
  sub: string;
  provider: OAuthProvider;
  providerId: string;
  providerEmail: string;
}

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const invalid = () =>
  new BadRequestException(
    'El enlace para vincular expiró. Vuelve a entrar con Google.',
  );

@Injectable()
export class PendingLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  private get secret() {
    return this.config.get<string>('jwt.secret') ?? 'dev-secret';
  }

  create(userId: string, profile: OAuthProfile) {
    const payload: PendingLink = {
      purpose: 'oauth-pending-link',
      sub: userId,
      provider: profile.provider,
      providerId: profile.providerId,
      providerEmail: profile.email ?? '',
    };
    return this.jwt.sign(payload, { secret: this.secret, expiresIn: '10m' });
  }

  private read(token: string): PendingLink {
    try {
      const payload = this.jwt.verify<PendingLink>(token, {
        secret: this.secret,
      });
      if (payload.purpose !== 'oauth-pending-link') throw invalid();
      return payload;
    } catch {
      throw invalid();
    }
  }

  private findUser(id: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        password: true,
        passwordSetAt: true,
      },
    });
  }

  /** Datos para pintar la pantalla de confirmación. */
  async describe(token: string) {
    const link = this.read(token);
    const user = await this.findUser(link.sub);
    return {
      email: user.email,
      name: user.name,
      provider: link.provider,
      hasPassword: user.passwordSetAt !== null,
    };
  }

  /** Envía un código de 6 dígitos al correo de la cuenta. */
  async sendCode(token: string) {
    const link = this.read(token);
    const user = await this.findUser(link.sub);
    const code = randomInt(100000, 1000000).toString();
    const ttl = this.config.get<number>('resetCode.ttlMinutes') ?? 15;
    await this.prisma.passwordResetCode.updateMany({
      where: { email: user.email, purpose: 'VERIFY_EMAIL', usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.prisma.passwordResetCode.create({
      data: {
        purpose: 'VERIFY_EMAIL',
        email: user.email,
        codeHash: sha256(code),
        expiresAt: new Date(Date.now() + ttl * 60_000),
      },
    });
    await this.mail.sendEmailVerificationCode(user.email, user.name, code);
    return { message: `Te enviamos un código a ${user.email}.` };
  }

  /**
   * Comprueba la contraseña o el código y vincula el proveedor. Devuelve el
   * usuario para que el controlador abra la sesión.
   */
  async confirm(token: string, proof: { password?: string; code?: string }) {
    const link = this.read(token);
    const user = await this.findUser(link.sub);

    if (proof.password) {
      const ok =
        user.passwordSetAt !== null &&
        (await bcrypt.compare(proof.password, user.password));
      if (!ok) throw new BadRequestException('La contraseña es incorrecta.');
    } else if (proof.code) {
      await this.consumeCode(user.email, proof.code);
    } else {
      throw new BadRequestException('Ingresa tu contraseña o el código.');
    }

    const existing = await this.prisma.identityProvider.findUnique({
      where: {
        provider_providerId: {
          provider: link.provider,
          providerId: link.providerId,
        },
      },
      select: { userId: true },
    });
    if (existing && existing.userId !== user.id) {
      throw new ConflictException(
        'Esa cuenta de Google ya está vinculada a otro usuario.',
      );
    }
    if (!existing) {
      await this.prisma.identityProvider.create({
        data: {
          userId: user.id,
          provider: link.provider,
          providerId: link.providerId,
          email: link.providerEmail || user.email,
        },
      });
    }
    // Google verificó el correo y la persona probó ser la dueña.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
    return { id: user.id, email: user.email };
  }

  private async consumeCode(email: string, code: string) {
    const record = await this.prisma.passwordResetCode.findFirst({
      where: {
        email,
        purpose: 'VERIFY_EMAIL',
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!record)
      throw new BadRequestException('El código es inválido o ha expirado.');

    const expected = Buffer.from(record.codeHash, 'hex');
    const given = Buffer.from(sha256(code), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      const max = this.config.get<number>('resetCode.maxAttempts') ?? 5;
      const updated = await this.prisma.passwordResetCode.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      if (updated.attempts >= max) {
        await this.prisma.passwordResetCode.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        });
      }
      throw new BadRequestException('El código es incorrecto.');
    }
    await this.prisma.passwordResetCode.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
  }
}
