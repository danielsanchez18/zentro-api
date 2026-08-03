import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateMeDto } from './dto/update-me.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** Perfil del usuario + memberships (orgs, rol, suscripción) + onboarding + prefs. */
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerifiedAt: true,
        createdAt: true,
        memberships: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            isActive: true,
            role: {
              select: { id: true, name: true, system: true },
            },
            organization: {
              select: {
                id: true,
                slug: true,
                name: true,
                industry: true,
                status: true,
                modules: true,
                features: true,
                subscription: {
                  select: { id: true, status: true, provider: true, trialEndsAt: true },
                },
              },
            },
          },
        },
        onboardingProgress: {
          select: { id: true, steps: true, completedAt: true },
        },
        notificationPrefs: {
          select: { id: true, type: true, channel: true, enabled: true },
        },
      },
    });

    if (!user) {
      throw new BadRequestException('Usuario no encontrado');
    }

    return { user };
  }

  /** Actualiza datos del perfil (name/email). */
  async updateMe(userId: string, dto: UpdateMeDto) {
    const existing = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (dto.email && dto.email.toLowerCase() !== existing.email) {
      const conflict = await this.prisma.user.findUnique({
        where: { email: dto.email.toLowerCase() },
        select: { id: true },
      });
      if (conflict) {
        throw new BadRequestException('Ese correo ya está en uso');
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name ?? existing.name,
        email: dto.email ? dto.email.toLowerCase() : existing.email,
      },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    });

    return { user };
  }
}