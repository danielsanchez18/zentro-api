import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  BadGatewayException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const PUBLIC_USER_FIELDS = {
  id: true,
  email: true,
  name: true,
  organization: true,
  branch: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new ConflictException('Este correo ya está registrado');
    }

    const hashed = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        password: hashed,
        name: dto.name,
      },
      select: PUBLIC_USER_FIELDS,
    });

    return {
      user,
      token: this.signToken(user.id, user.email),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const { password: _password, ...safeUser } = user;

    return {
      user: safeUser,
      token: this.signToken(user.id, user.email),
    };
  }

  async checkEmail(email: string): Promise<{ exists: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });

    return { exists: !!user };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: PUBLIC_USER_FIELDS,
    });

    if (!user) {
      throw new UnauthorizedException('Usuario no encontrado');
    }

    return { user };
  }

  /* ------------------------------------------------------------------ */
  /* Forgot password                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Solicita un código de recuperación.
   * Siempre responde lo mismo (exista o no el correo) para no revelar
   * qué emails están registrados (anti-enumeración). El código se envía
   * solo si el usuario existe.
   */
  async forgotPassword(email: string) {
    const normalized = email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, email: true, name: true },
    });

    let devCode: string | undefined;

    if (user) {
      const code = this.generateCode();
      const codeHash = this.hashCode(code);
      const ttlMinutes = this.config.get<number>('resetCode.ttlMinutes') ?? 15;

      // Invalida códigos anteriores sin usar para el mismo correo
      await this.prisma.passwordResetCode.updateMany({
        where: { email: normalized, usedAt: null },
        data: { usedAt: new Date() },
      });

      await this.prisma.passwordResetCode.create({
        data: {
          email: normalized,
          codeHash,
          expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
        },
      });

      try {
        await this.mail.sendPasswordResetCode(user.email, user.name, code);
      } catch {
        throw new BadGatewayException('No pudimos enviar el correo. Inténtalo de nuevo.');
      }

      // En desarrollo el código se devuelve para poder probar el flujo
      // sin abrir el correo (E2E, demos). Nunca en producción.
      if (process.env.NODE_ENV !== 'production') {
        devCode = code;
      }
    }

    return {
      message: 'Si el correo está registrado, recibirás un código de recuperación.',
      ...(devCode ? { devCode } : {}),
    };
  }

  /** Valida un código sin consumirlo (pantalla OTP antes de la nueva contraseña). */
  async verifyCode(email: string, code: string) {
    const record = await this.findValidRecord(email.toLowerCase());
    if (!record) {
      throw new BadRequestException('El código es inválido o ha expirado.');
    }

    if (record.codeHash !== this.hashCode(code)) {
      await this.registerFailedAttempt(record.id);
      throw new BadRequestException('El código es incorrecto.');
    }

    return { valid: true };
  }

  /** Valida el código y actualiza la contraseña. Consume el código. */
  async resetPassword(email: string, code: string, newPassword: string) {
    const normalized = email.toLowerCase();
    const record = await this.findValidRecord(normalized);
    if (!record) {
      throw new BadRequestException('El código es inválido o ha expirado.');
    }

    if (record.codeHash !== this.hashCode(code)) {
      await this.registerFailedAttempt(record.id);
      throw new BadRequestException('El código es incorrecto.');
    }

    const hashed = await bcrypt.hash(newPassword, 10);

    await this.prisma.user.update({
      where: { email: normalized },
      data: { password: hashed },
    });

    // Consume el código usado y deja inservibles los demás del mismo correo
    await this.prisma.passwordResetCode.updateMany({
      where: { email: normalized, usedAt: null },
      data: { usedAt: new Date() },
    });

    return { message: 'Tu contraseña fue actualizada. Ya puedes iniciar sesión.' };
  }

  /* ------------------------------------------------------------------ */
  /* Helpers de recuperación                                             */
  /* ------------------------------------------------------------------ */

  private findValidRecord(email: string) {
    return this.prisma.passwordResetCode.findFirst({
      where: { email, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async registerFailedAttempt(recordId: string) {
    const maxAttempts = this.config.get<number>('resetCode.maxAttempts') ?? 5;

    const updated = await this.prisma.passwordResetCode.update({
      where: { id: recordId },
      data: { attempts: { increment: 1 } },
    });

    // Si se agotan los intentos, el código queda inservible
    if (updated.attempts >= maxAttempts) {
      await this.prisma.passwordResetCode.update({
        where: { id: recordId },
        data: { usedAt: new Date() },
      });
    }
  }

  private generateCode(): string {
    return randomInt(100000, 1000000).toString();
  }

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private signToken(userId: string, email: string): string {
    return this.jwt.sign(
      { sub: userId, email },
      {
        secret: this.config.get('jwt.secret') ?? 'dev-secret',
        expiresIn: this.config.get('jwt.expiresIn') ?? '7d',
      },
    );
  }
}
