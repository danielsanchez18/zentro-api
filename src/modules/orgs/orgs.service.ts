import {
  BadRequestException,
  ConflictException,
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateOrgDto,
  UpdateOrgDto,
  UpdateOrgFeaturesDto,
} from './dto/orgs.dto';

@Injectable()
export class OrgsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Crea una organización con:
   * - Rol "Owner" (system) con todos los permisos del catálogo (decisión 3.6).
   * - Membership OWNER para el creador.
   * - Sucursal principal automática (type=MAIN, isDefault=true).
   * - Suscripción TRIALING de 30 días ligada al plan de trial.
   *
   * Validaciones:
   * - El slug es ÚNICO a nivel global (los tenants conviven en /app/:slug).
   * - El NOMBRE es único POR USUARIO: X no puede crear dos "Zentro", pero
   *   usuarios distintos sí pueden usar el mismo nombre (cada tenant tiene su slug).
   */
  async create(userId: string, dto: CreateOrgDto) {
    const slug = dto.slug.toLowerCase();

    const existing = await this.prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Ese slug ya está en uso');
    }

    // Nombre único por usuario: si el usuario ya es miembro ACTIVE de una org
    // con el mismo nombre (case-insensitive), se rechaza.
    const duplicateName = await this.prisma.membership.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        organization: {
          name: { equals: dto.name, mode: 'insensitive' },
        },
      },
      select: { id: true },
    });
    if (duplicateName) {
      throw new ConflictException(
        `Ya tienes una organización llamada "${dto.name}"`,
      );
    }

    const permissions = await this.prisma.permission.findMany({
      where: { scope: 'ORG' },
      select: { code: true },
    });
    const allCodes = permissions.map((p) => p.code);

    const trialPlan = await this.prisma.plan.findUnique({
      where: { slug: this.config.get('trial.planSlug') ?? 'trial' },
    });
    if (!trialPlan) {
      throw new BadRequestException(
        'El plan de prueba no existe. Ejecuta el seed (pnpm prisma db seed).',
      );
    }
    const trialDays = this.config.get<number>('trial.days') ?? 30;
    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);

    const organization = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: dto.name,
          slug,
          status: 'REGISTERED',
        },
      });

      const role = await tx.role.create({
        data: {
          organizationId: org.id,
          name: 'Owner',
          system: true,
          permissionCodes: allCodes,
        },
      });

      await tx.membership.create({
        data: {
          userId,
          organizationId: org.id,
          roleId: role.id,
          status: 'ACTIVE',
          isActive: true,
        },
      });

      await tx.branch.create({
        data: {
          organizationId: org.id,
          name: 'Sucursal principal',
          type: 'MAIN',
          isDefault: true,
        },
      });

      await tx.subscription.create({
        data: {
          organizationId: org.id,
          planId: trialPlan.id,
          status: 'TRIALING',
          provider: 'MOCK',
          trialEndsAt,
          periodStart: now,
          periodEnd: trialEndsAt,
          storageLimitMb: trialPlan.storageLimit,
          transactionLimit: trialPlan.transactionLimit,
        },
      });

      return org;
    });

    return this.getOrg(userId, organization.id);
  }

  /**
   * Verificación unificada (botón "Verificar" del form de creación):
   * - `nameTaken`: ¿el usuario ya tiene una org ACTIVE con ese nombre?
   *   (única POR USUARIO: otro usuario sí puede usar el mismo nombre).
   * - `slugAvailable`: ¿el slug está libre? (único GLOBAL).
   * - `suggestions`: alternativas si el slug está ocupado.
   */
  async checkAvailability(userId: string, rawName: string, rawSlug: string) {
    const name = rawName?.trim() ?? '';
    const slug = rawSlug?.toLowerCase().trim() ?? '';

    let nameTaken = false;
    if (name) {
      const dup = await this.prisma.membership.findFirst({
        where: {
          userId,
          status: 'ACTIVE',
          organization: { name: { equals: name, mode: 'insensitive' } },
        },
        select: { id: true },
      });
      nameTaken = !!dup;
    }

    let slugAvailable = true;
    let suggestions: string[] = [];
    if (slug && /^[a-z0-9-]+$/.test(slug)) {
      const taken = await this.prisma.organization.findUnique({
        where: { slug },
        select: { id: true },
      });
      slugAvailable = !taken;
      if (taken) {
        suggestions = await this.buildSlugSuggestions(slug);
      }
    }

    return { nameTaken, slugAvailable, suggestions };
  }

  /** Sugiere alternativas de slug libres (tags naturales + numéricos). */
  private async buildSlugSuggestions(slug: string): Promise<string[]> {
    const naturalTags = ['digital', 'online', 'shop'];
    const candidates: string[] = [];
    for (const tag of naturalTags) candidates.push(`${slug}-${tag}`);
    const parts = slug.split('-');
    if (parts.length > 1) {
      candidates.push([...parts.slice(1), parts[0]].join('-'));
    }
    for (let i = 2; i < 50; i++) candidates.push(`${slug}-${i}`);

    const suggestions: string[] = [];
    for (const candidate of candidates) {
      if (suggestions.length >= 3) break;
      const exists = await this.prisma.organization.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!exists) suggestions.push(candidate);
    }
    return suggestions;
  }

  /** Lista las orgs del usuario con su rol, plan y estado de suscripción. */
  async listForUser(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        isActive: true,
        role: { select: { id: true, name: true, system: true } },
        organization: {
          select: {
            id: true,
            slug: true,
            name: true,
            industry: true,
            status: true,
            createdAt: true,
            _count: {
              select: { memberships: true, branches: true },
            },
            subscription: {
              select: {
                id: true,
                status: true,
                provider: true,
                trialEndsAt: true,
                plan: { select: { id: true, slug: true, name: true, price: true } },
              },
            },
          },
        },
      },
    });

    const organizations = memberships.map((m) => ({
      ...m.organization,
      role: m.role.name,
      members: m.organization._count.memberships,
      branches: m.organization._count.branches,
    }));

    return { organizations };
  }

  /** Detalle de una org (verifica membership ACTIVE). */
  async getOrg(userId: string, orgId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, organizationId: orgId, status: 'ACTIVE' },
      select: {
        id: true,
        isActive: true,
        role: { select: { id: true, name: true, system: true, permissionCodes: true } },
      },
    });
    if (!membership) {
      throw new ForbiddenException('No tienes acceso a esta organización');
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        slug: true,
        name: true,
        legalName: true,
        email: true,
        phone: true,
        logoUrl: true,
        timezone: true,
        industry: true,
        description: true,
        country: true,
        currency: true,
        status: true,
        modules: true,
        features: true,
        createdAt: true,
        branches: true,
        subscription: {
          select: {
            id: true,
            status: true,
            provider: true,
            trialEndsAt: true,
            storageLimitMb: true,
            transactionLimit: true,
            plan: { select: { id: true, slug: true, name: true, price: true } },
          },
        },
      },
    });

    return { organization, membership };
  }

  /** Actualiza datos de la org (Owner/Admin). */
  async update(userId: string, orgId: string, dto: UpdateOrgDto) {
    const member = await this.requireAdmin(userId, orgId);

    const organization = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        name: dto.name,
        legalName: dto.legalName,
        email: dto.email,
        phone: dto.phone,
        logoUrl: dto.logoUrl,
        industry: dto.industry,
        description: dto.description,
        country: dto.country,
        currency: dto.currency,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        industry: true,
        country: true,
        currency: true,
        status: true,
        modules: true,
        features: true,
      },
    });

    void member;
    return { organization };
  }

  /** Guarda rubro + módulos/features de la org (Owner/Admin). */
  async updateFeatures(userId: string, orgId: string, dto: UpdateOrgFeaturesDto) {
    await this.requireAdmin(userId, orgId);

    const organization = await this.prisma.organization.update({
      where: { id: orgId },
      data: {
        modules: dto.modules,
        features: dto.features,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        industry: true,
        modules: true,
        features: true,
      },
    });

    return { organization };
  }

  /** Verifica que el usuario sea Owner o Admin de la org. */
  private async requireAdmin(userId: string, orgId: string) {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, organizationId: orgId, status: 'ACTIVE' },
      select: { id: true, role: { select: { name: true } } },
    });

    if (!membership) {
      throw new ForbiddenException('No tienes acceso a esta organización');
    }
    if (!['Owner', 'Admin'].includes(membership.role.name)) {
      throw new ForbiddenException('Requieres el rol Owner o Admin');
    }
    return membership;
  }
}