import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuthenticatedRequest extends Request {
  user: { userId: string; email: string };
  tenant?: { organizationId: string };
}

/**
 * Guard de tenant: valida que el usuario autenticado tenga una Membership ACTIVE
 * en la organización indicada por el header `X-Tenant-Id`, y adjunta
 * `request.tenant = { organizationId }` para que los repositorios filtren por él.
 *
 * Uso (rutas del workspace):
 *   @UseGuards(JwtAuthGuard, TenantGuard)
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;

    if (!user?.userId) {
      throw new ForbiddenException('No autorizado');
    }

    const tenantId = request.headers['x-tenant-id'] as string | undefined;
    if (!tenantId) {
      throw new ForbiddenException('Falta el encabezado X-Tenant-Id');
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        userId: user.userId,
        organizationId: tenantId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    if (!membership) {
      throw new ForbiddenException(
        'No tienes acceso a este tenant o tu membresía no está activa',
      );
    }

    request.tenant = { organizationId: tenantId };
    return true;
  }
}