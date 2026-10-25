import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

export interface SessionMeta {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Sesiones con refresh token rotativo.
 * - El token en claro solo viaja en la cookie httpOnly; en BD se guarda su hash.
 * - Cada `rotate` invalida el token anterior y emite uno nuevo.
 * - Revocar una sesión cierra ese dispositivo; `revokeAll` cierra todos.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get ttlMs() {
    const days = this.config.get<number>('session.refreshTtlDays') ?? 30;
    return days * 24 * 60 * 60 * 1000;
  }

  private hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private newToken() {
    return randomBytes(48).toString('base64url');
  }

  async create(userId: string, meta: SessionMeta = {}) {
    const refreshToken = this.newToken();
    const session = await this.prisma.userSession.create({
      data: {
        userId,
        refreshTokenHash: this.hash(refreshToken),
        userAgent: meta.userAgent?.slice(0, 300),
        ipAddress: meta.ipAddress,
        expiresAt: new Date(Date.now() + this.ttlMs),
      },
    });
    return { session, refreshToken };
  }

  /** Valida el refresh token y lo rota. Lanza 401 si no es válido. */
  async rotate(refreshToken: string | undefined, meta: SessionMeta = {}) {
    if (!refreshToken) throw new UnauthorizedException('Sesión no encontrada');

    const session = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: this.hash(refreshToken) },
    });

    if (!session || session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException(
        'La sesión expiró. Inicia sesión de nuevo.',
      );
    }

    const nextToken = this.newToken();
    const updated = await this.prisma.userSession.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: this.hash(nextToken),
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + this.ttlMs),
        ...(meta.userAgent ? { userAgent: meta.userAgent.slice(0, 300) } : {}),
        ...(meta.ipAddress ? { ipAddress: meta.ipAddress } : {}),
      },
    });

    return { session: updated, refreshToken: nextToken };
  }

  /** Revoca la sesión asociada al refresh token (logout). No falla si no existe. */
  async revokeByToken(refreshToken: string | undefined) {
    if (!refreshToken) return;
    await this.prisma.userSession.updateMany({
      where: { refreshTokenHash: this.hash(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revoca todas las sesiones activas de un usuario (p. ej. al cambiar la contraseña). */
  async revokeAll(userId: string) {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Una sesión está activa si no fue revocada ni expiró. */
  async isActive(sessionId: string) {
    const session = await this.prisma.userSession.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, expiresAt: true },
    });
    return Boolean(
      session && !session.revokedAt && session.expiresAt > new Date(),
    );
  }
}
