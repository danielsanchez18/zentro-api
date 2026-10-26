import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateOrganizationDto,
  OrganizationSetupDto,
  UpdateOrganizationDto,
} from './organizations.dto';

/** Rutas propias de la app que no pueden usarse como slug. */
const RESERVED_SLUGS = new Set([
  'app',
  'api',
  'admin',
  'dashboard',
  'www',
  'ayuda',
  'soporte',
  'ingresar',
  'registrar',
  'cuenta',
]);

const TRIAL_DAYS = 30;
const OWNER_ROLE = 'Owner';

/** Estado de suscripción en el formato del Hub. */
const SUBSCRIPTION_STATUS: Record<string, string> = {
  TRIALING: 'TRIAL',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELED: 'CANCELED',
};

const summarySelect = {
  id: true,
  name: true,
  slug: true,
  logoUrl: true,
  coverUrl: true,
  industry: true,
  modules: true,
  setupCompletedAt: true,
  setupSkippedAt: true,
  createdAt: true,
  Subscription: {
    select: {
      status: true,
      trialEndsAt: true,
      Plan: { select: { name: true } },
    },
  },
  _count: {
    select: {
      Membership: { where: { status: 'ACTIVE' } },
      Branch: { where: { status: 'ACTIVE' } },
    },
  },
} as const;

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  coverUrl: string | null;
  industry: string | null;
  modules: unknown;
  setupCompletedAt: Date | null;
  setupSkippedAt: Date | null;
  createdAt: Date;
  Subscription: {
    status: string;
    trialEndsAt: Date | null;
    Plan: { name: string };
  } | null;
  _count: { Membership: number; Branch: number };
};

/**
 * Organizaciones del Hub (ADR 009 + decisiones de producto oct-2026):
 * - Crear una organización NO crea sucursales (0..N, se definen en el onboarding).
 * - Solo se siembra el rol Owner (todos los permisos); el creador lo recibe.
 * - Nace con una suscripción de prueba de 30 días (plan `trial`).
 */
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  /* ---------------------------- Acceso ---------------------------- */

  /** Membresía activa del usuario; 404 si no es miembro (no revela que existe). */
  async membership(userId: string, organizationId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: {
        status: true,
        Role: { select: { name: true, permissionCodes: true } },
      },
    });
    if (!membership || membership.status !== 'ACTIVE')
      throw new NotFoundException('Organización no encontrada.');
    return membership;
  }

  async requirePermission(
    userId: string,
    organizationId: string,
    code: string,
  ) {
    const membership = await this.membership(userId, organizationId);
    const codes = membership.Role.permissionCodes as string[];
    if (!Array.isArray(codes) || !codes.includes(code))
      throw new ForbiddenException('No tienes permiso para esta acción.');
    return membership;
  }

  /* --------------------------- Lectura --------------------------- */

  private toSummary(row: OrganizationRow, role: string) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      logoUrl: row.logoUrl,
      coverUrl: row.coverUrl,
      role,
      plan: row.Subscription?.Plan.name ?? 'Sin plan',
      status: row.Subscription
        ? (SUBSCRIPTION_STATUS[row.Subscription.status] ??
          row.Subscription.status)
        : 'TRIAL',
      trialEndsAt: row.Subscription?.trialEndsAt ?? null,
      members: row._count.Membership,
      branches: row._count.Branch,
      industry: row.industry,
      capabilities: Array.isArray(row.modules) ? (row.modules as string[]) : [],
      setupStatus: row.setupCompletedAt ? 'READY' : 'DRAFT',
      setupSkippedAt: row.setupSkippedAt,
      createdAt: row.createdAt,
    };
  }

  async list(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: {
        Role: { select: { name: true } },
        Organization: { select: summarySelect },
      },
    });
    return {
      organizations: memberships.map((item) =>
        this.toSummary(item.Organization as OrganizationRow, item.Role.name),
      ),
    };
  }

  async detail(userId: string, organizationId: string) {
    const membership = await this.membership(userId, organizationId);
    const [row, branches] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: summarySelect,
      }),
      this.prisma.branch.findMany({
        where: { organizationId, status: 'ACTIVE' },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          isDefault: true,
          address: true,
          phone: true,
          openingHours: true,
        },
      }),
    ]);
    return {
      organization: {
        ...this.toSummary(row, membership.Role.name),
        permissions: membership.Role.permissionCodes,
        branchList: branches.map((branch) => ({
          id: branch.id,
          name: branch.name,
          isPrimary: branch.isDefault,
          address: branch.address,
          phone: branch.phone,
          openingHours:
            (branch.openingHours as { summary?: string } | null)?.summary ??
            null,
        })),
      },
    };
  }

  async slugAvailable(slug: string) {
    const normalized = slug.trim().toLowerCase();
    if (RESERVED_SLUGS.has(normalized)) return { available: false };
    const taken = await this.prisma.organization.findUnique({
      where: { slug: normalized },
      select: { id: true },
    });
    return { available: !taken };
  }

  /* ---------------------------- Escritura ---------------------------- */

  async create(userId: string, dto: CreateOrganizationDto) {
    const slug = dto.slug.trim().toLowerCase();
    if (!(await this.slugAvailable(slug)).available)
      throw new ConflictException('Esa dirección ya está en uso. Prueba otra.');

    const [permissions, trialPlan] = await Promise.all([
      this.prisma.permission.findMany({ select: { code: true } }),
      this.prisma.plan.findUnique({
        where: { slug: 'trial' },
        select: { id: true, storageLimit: true, transactionLimit: true },
      }),
    ]);

    const now = new Date();
    const organization = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { name: dto.name.trim(), slug },
        select: { id: true },
      });
      const owner = await tx.role.create({
        data: {
          organizationId: created.id,
          name: OWNER_ROLE,
          system: true,
          description: 'Dueño de la organización: todos los permisos.',
          permissionCodes: permissions.map((item) => item.code),
        },
        select: { id: true },
      });
      await tx.membership.create({
        data: {
          userId,
          organizationId: created.id,
          roleId: owner.id,
          status: 'ACTIVE',
        },
      });
      if (trialPlan) {
        await tx.subscription.create({
          data: {
            organizationId: created.id,
            planId: trialPlan.id,
            status: 'TRIALING',
            periodStart: now,
            trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 86_400_000),
            storageLimitMb: trialPlan.storageLimit,
            transactionLimit: trialPlan.transactionLimit,
          },
        });
      }
      return created;
    });

    return this.detail(userId, organization.id);
  }

  async update(
    userId: string,
    organizationId: string,
    dto: UpdateOrganizationDto,
  ) {
    await this.requirePermission(userId, organizationId, 'ORG.UPDATE');
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { ...(dto.name ? { name: dto.name.trim() } : {}) },
    });
    return this.detail(userId, organizationId);
  }

  /**
   * Guarda el onboarding. Las sucursales enviadas reemplazan a las actuales
   * (la primera es la principal); una lista vacía deja la organización sin sucursales.
   */
  async saveSetup(
    userId: string,
    organizationId: string,
    dto: OrganizationSetupDto,
  ) {
    await this.requirePermission(userId, organizationId, 'ORG.UPDATE');
    const branches = dto.branches.filter((branch) => branch.name.trim());
    await this.prisma.$transaction([
      this.prisma.organization.update({
        where: { id: organizationId },
        data: {
          industry: dto.industry,
          modules: [...new Set(dto.capabilities)],
          setupCompletedAt: new Date(),
          setupSkippedAt: null,
        },
      }),
      this.prisma.branch.deleteMany({ where: { organizationId } }),
      ...branches.map((branch, index) =>
        this.prisma.branch.create({
          data: {
            organizationId,
            name: branch.name.trim(),
            isDefault: index === 0,
            type: index === 0 ? 'MAIN' : 'BRANCH',
            address: branch.address?.trim() || null,
            phone: branch.phone?.trim() || null,
            openingHours: branch.openingHours?.trim()
              ? { summary: branch.openingHours.trim() }
              : {},
          },
        }),
      ),
    ]);
    return this.detail(userId, organizationId);
  }

  /** "Configurar después": queda pendiente y se puede retomar. */
  async skipSetup(userId: string, organizationId: string) {
    await this.requirePermission(userId, organizationId, 'ORG.UPDATE');
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { setupSkippedAt: new Date() },
    });
    return this.detail(userId, organizationId);
  }
}
