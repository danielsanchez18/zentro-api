import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { SessionService } from '../session.service';
import { NotificationsService } from '../../notifications/notifications.service';
import type { OAuthProvider } from '../oauth/oauth.types';
import { UpdateProfileDto } from './account.dto';

/**
 * Avisos por correo.
 * - Obligatorios (transaccionales): seguridad, recuperación, invitaciones y
 *   facturación crítica (cobro rechazado, factura emitida). No se apagan.
 * - Opcionales sensibles: recordatorios de facturación (el frontend confirma
 *   antes de apagarlos).
 * - Opcionales: resumen de actividad y novedades (estas apagadas por defecto).
 */
export const NOTIFICATION_KEYS = [
  'SECURITY',
  'RECOVERY',
  'INVITATIONS',
  'BILLING',
  'BILLING_REMINDERS',
  'ACTIVITY_DIGEST',
  'PRODUCT_UPDATES',
] as const;
export type NotificationKey = (typeof NOTIFICATION_KEYS)[number];
const REQUIRED_NOTIFICATIONS: NotificationKey[] = [
  'SECURITY',
  'RECOVERY',
  'INVITATIONS',
  'BILLING',
];
const SENSITIVE_NOTIFICATIONS: NotificationKey[] = ['BILLING_REMINDERS'];
const DEFAULT_DISABLED: NotificationKey[] = ['PRODUCT_UPDATES'];

/** Proveedores que hoy se pueden vincular (Apple pausado). */
const LINKABLE_PROVIDERS: OAuthProvider[] = ['GOOGLE'];

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

/**
 * "Mi cuenta": perfil, verificación de correo, contraseña, métodos de acceso,
 * dispositivos (sesiones) y preferencias de notificación del usuario autenticado.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly sessions: SessionService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ----------------------------- Perfil ----------------------------- */

  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        avatarUrl: true,
        emailVerifiedAt: true,
        passwordSetAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) throw new UnauthorizedException('Usuario no encontrado');
    const { passwordSetAt, ...rest } = user;
    return {
      user: { ...rest, hasPassword: passwordSetAt !== null, passwordSetAt },
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone.trim() || null } : {}),
      },
    });
    return this.profile(userId);
  }

  async updateAvatar(userId: string, avatarUrl: string | null) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: avatarUrl || null },
    });
    return this.profile(userId);
  }

  /* -------------------- Guía "Primeros pasos" -------------------- */

  async onboarding(userId: string) {
    const progress = await this.prisma.onboardingProgress.findUnique({
      where: { userId },
      select: { steps: true },
    });
    const steps = (progress?.steps ?? {}) as { skippedAt?: string | null };
    return { skippedAt: steps.skippedAt ?? null };
  }

  async updateOnboarding(userId: string, skipped: boolean) {
    const steps = { skippedAt: skipped ? new Date().toISOString() : null };
    await this.prisma.onboardingProgress.upsert({
      where: { userId },
      create: { userId, steps },
      update: { steps },
    });
    return { skippedAt: steps.skippedAt };
  }

  /* ------------------------ Verificar correo ------------------------ */

  async sendEmailVerification(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, name: true, emailVerifiedAt: true },
    });
    if (user.emailVerifiedAt)
      throw new ConflictException('Tu correo ya está verificado.');

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

  async confirmEmailVerification(userId: string, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    const record = await this.prisma.passwordResetCode.findFirst({
      where: {
        email: user.email,
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

    await this.prisma.$transaction([
      this.prisma.passwordResetCode.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);
    return this.profile(userId);
  }

  /* --------------------------- Contraseña --------------------------- */

  /** Paso 1 del cambio de contraseña: confirma la actual antes de pedir la nueva. */
  async verifyPassword(userId: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { password: true, passwordSetAt: true },
    });
    const ok =
      user.passwordSetAt !== null &&
      (await bcrypt.compare(password, user.password));
    if (!ok)
      throw new BadRequestException('La contraseña actual es incorrecta.');
    return { valid: true };
  }

  /**
   * Cambia la contraseña (pide la actual) o la crea si la cuenta se registró
   * con Google. Cierra las demás sesiones; la actual se mantiene.
   */
  async changePassword(
    userId: string,
    currentSessionId: string | undefined,
    currentPassword: string | undefined,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { password: true, passwordSetAt: true },
    });

    if (user.passwordSetAt) {
      const ok =
        currentPassword &&
        (await bcrypt.compare(currentPassword, user.password));
      if (!ok)
        throw new BadRequestException('La contraseña actual es incorrecta.');
      if (await bcrypt.compare(newPassword, user.password))
        throw new BadRequestException(
          'La nueva contraseña debe ser distinta de la actual.',
        );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        password: await bcrypt.hash(newPassword, 10),
        passwordSetAt: new Date(),
      },
    });
    await this.revokeOtherSessions(userId, currentSessionId);
    await this.notifications.notify(userId, {
      type: 'SECURITY',
      title: user.passwordSetAt
        ? 'Contraseña actualizada'
        : 'Contraseña creada',
      body: 'Cerramos tus sesiones en otros dispositivos. Si no fuiste tú, recupera tu cuenta.',
      href: '/dashboard/cuenta?tab=seguridad',
    });
    return {
      message: user.passwordSetAt
        ? 'Tu contraseña fue actualizada.'
        : 'Creaste tu contraseña.',
    };
  }

  /* ------------------------ Métodos de acceso ------------------------ */

  async identities(userId: string) {
    const [user, identities] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, passwordSetAt: true },
      }),
      this.prisma.identityProvider.findMany({
        where: { userId },
        select: { id: true, provider: true, email: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      methods: [
        {
          provider: 'PASSWORD',
          connected: user.passwordSetAt !== null,
          email: user.email,
          connectedAt: user.passwordSetAt,
        },
        ...LINKABLE_PROVIDERS.map((provider) => {
          const identity = identities.find(
            (item) => item.provider === provider,
          );
          return {
            provider,
            connected: Boolean(identity),
            email: identity?.email ?? null,
            connectedAt: identity?.createdAt ?? null,
          };
        }),
      ],
    };
  }

  /** Nunca deja la cuenta sin una forma de iniciar sesión. */
  async unlinkIdentity(userId: string, provider: string) {
    const normalized = provider.toUpperCase();
    if (normalized === 'PASSWORD') {
      throw new BadRequestException(
        'La contraseña no se puede desvincular; puedes cambiarla.',
      );
    }
    const [user, identities] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { passwordSetAt: true },
      }),
      this.prisma.identityProvider.findMany({
        where: { userId },
        select: { id: true, provider: true },
      }),
    ]);
    const target = identities.find((item) => item.provider === normalized);
    if (!target) throw new NotFoundException('Ese método no está vinculado.');

    const remaining = identities.length - 1 + (user.passwordSetAt ? 1 : 0);
    if (remaining === 0) {
      throw new ConflictException(
        'Es tu único método de acceso. Crea una contraseña antes de desvincularlo.',
      );
    }

    await this.prisma.identityProvider.delete({ where: { id: target.id } });
    await this.notifications.notify(userId, {
      type: 'SECURITY',
      title: 'Google desconectado',
      body: 'Ya no puedes entrar con tu cuenta de Google.',
      href: '/dashboard/cuenta?tab=seguridad',
    });
    return this.identities(userId);
  }

  /* --------------------------- Dispositivos --------------------------- */

  async sessionsList(userId: string, currentSessionId: string | undefined) {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });
    return {
      sessions: sessions.map((session) => ({
        ...session,
        current: session.id === currentSessionId,
      })),
    };
  }

  async revokeSession(userId: string, sessionId: string) {
    const result = await this.prisma.userSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0)
      throw new NotFoundException('Sesión no encontrada.');
  }

  async revokeOtherSessions(
    userId: string,
    currentSessionId: string | undefined,
  ) {
    await this.prisma.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(currentSessionId ? { id: { not: currentSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  /* -------------------------- Notificaciones -------------------------- */

  async notificationPreferences(userId: string) {
    const stored = await this.prisma.notificationPreference.findMany({
      where: { userId, channel: 'EMAIL' },
      select: { type: true, enabled: true },
    });
    return {
      preferences: NOTIFICATION_KEYS.map((key) => {
        const required = REQUIRED_NOTIFICATIONS.includes(key);
        const saved = stored.find((item) => item.type === key);
        return {
          key,
          required,
          sensitive: SENSITIVE_NOTIFICATIONS.includes(key),
          emailEnabled: required
            ? true
            : (saved?.enabled ?? !DEFAULT_DISABLED.includes(key)),
        };
      }),
    };
  }

  async updateNotificationPreference(
    userId: string,
    key: string,
    emailEnabled: boolean,
  ) {
    const normalized = key.toUpperCase() as NotificationKey;
    if (!NOTIFICATION_KEYS.includes(normalized))
      throw new NotFoundException('Preferencia no encontrada.');
    if (REQUIRED_NOTIFICATIONS.includes(normalized)) {
      throw new BadRequestException(
        'Este aviso es obligatorio y no se puede desactivar.',
      );
    }
    await this.prisma.notificationPreference.upsert({
      where: { userId_type: { userId, type: normalized } },
      create: {
        userId,
        type: normalized,
        channel: 'EMAIL',
        enabled: emailEnabled,
      },
      update: { enabled: emailEnabled },
    });
    return this.notificationPreferences(userId);
  }
}
