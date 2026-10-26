import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export type NotificationType =
  'INVITATION' | 'BILLING' | 'SECURITY' | 'ORGANIZATION' | 'PRODUCT';

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body: string;
  href?: string;
}

const PAGE_SIZE = 30;

/** Navegador y sistema a partir del user-agent ("Chrome en Windows"). */
export const describeDevice = (userAgent?: string | null) => {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'un navegador';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'un dispositivo desconocido';
  return `${browser} en ${os}`;
};

/**
 * Notificaciones dentro de la app (campana del Hub).
 * `notify` es best-effort: si falla, la acción que la originó sigue igual.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async notify(userId: string, input: NotificationInput) {
    try {
      await this.prisma.notification.create({
        data: { userId, ...input, href: input.href ?? null },
      });
    } catch (error) {
      this.logger.warn(`No se pudo crear la notificación: ${String(error)}`);
    }
  }

  /** Notifica a quien tenga ese correo, si ya tiene cuenta. */
  async notifyEmail(email: string, input: NotificationInput) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    if (user) await this.notify(user.id, input);
  }

  async list(userId: string) {
    const [notifications, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: PAGE_SIZE,
        select: {
          id: true,
          type: true,
          title: true,
          body: true,
          href: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return { notifications, unreadCount };
  }

  async markRead(userId: string, id: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count === 0) {
      const exists = await this.prisma.notification.count({
        where: { id, userId },
      });
      if (!exists) throw new NotFoundException('Notificación no encontrada.');
    }
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
