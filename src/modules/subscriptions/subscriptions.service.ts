import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Estado de suscripción en el formato del Hub. */
const STATUS: Record<string, string> = {
  TRIALING: 'TRIAL',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELED: 'CANCELED',
};

/** -1 o ausente en `Plan.limits` = ilimitado (null). */
const limitOf = (limits: unknown, key: string): number | null => {
  const value = (limits as Record<string, unknown> | null)?.[key];
  return typeof value === 'number' && value >= 0 ? value : null;
};

/**
 * Suscripciones y facturas que ve el usuario en el Hub (solo lectura).
 * Incluye las organizaciones donde su rol tiene `BILLING.READ`. Cambiar de plan
 * y pagar se hará desde la organización cuando se conecte el proveedor de pagos.
 */
@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Ids de las organizaciones donde puedo ver la facturación. */
  private async billingOrganizationIds(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId, status: 'ACTIVE' },
      select: {
        organizationId: true,
        Role: { select: { permissionCodes: true } },
      },
    });
    return memberships
      .filter((item) => {
        const codes = item.Role.permissionCodes;
        return Array.isArray(codes) && codes.includes('BILLING.READ');
      })
      .map((item) => item.organizationId);
  }

  async listMine(userId: string) {
    const organizationIds = await this.billingOrganizationIds(userId);
    const rows = await this.prisma.subscription.findMany({
      where: { organizationId: { in: organizationIds } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        periodStart: true,
        periodEnd: true,
        trialEndsAt: true,
        Plan: {
          select: {
            slug: true,
            name: true,
            price: true,
            currency: true,
            interval: true,
            limits: true,
          },
        },
        Organization: {
          select: {
            id: true,
            name: true,
            slug: true,
            timezone: true,
            _count: {
              select: {
                Membership: { where: { status: 'ACTIVE' } },
                Branch: { where: { status: 'ACTIVE' } },
              },
            },
          },
        },
      },
    });

    return {
      subscriptions: rows.map((row) => ({
        id: row.id,
        status: STATUS[row.status] ?? row.status,
        trialEndsAt: row.trialEndsAt,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        organization: {
          id: row.Organization.id,
          name: row.Organization.name,
          slug: row.Organization.slug,
          timezone: row.Organization.timezone,
        },
        plan: {
          slug: row.Plan.slug,
          name: row.Plan.name,
          price: Number(row.Plan.price),
          currency: row.Plan.currency,
          interval: row.Plan.interval,
        },
        usage: {
          users: {
            used: row.Organization._count.Membership,
            limit: limitOf(row.Plan.limits, 'users'),
          },
          branches: {
            used: row.Organization._count.Branch,
            limit: limitOf(row.Plan.limits, 'branches'),
          },
        },
      })),
    };
  }

  async listInvoices(userId: string) {
    const organizationIds = await this.billingOrganizationIds(userId);
    const rows = await this.prisma.invoice.findMany({
      where: { organizationId: { in: organizationIds } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        number: true,
        status: true,
        amount: true,
        currency: true,
        periodStart: true,
        periodEnd: true,
        dueDate: true,
        paidAt: true,
        pdfUrl: true,
        createdAt: true,
        Organization: {
          select: { name: true, legalName: true, timezone: true },
        },
        Subscription: { select: { Plan: { select: { name: true } } } },
      },
    });
    return {
      invoices: rows.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        amount: Number(row.amount),
        currency: row.currency,
        periodStart: row.periodStart,
        periodEnd: row.periodEnd,
        dueDate: row.dueDate,
        paidAt: row.paidAt,
        issuedAt: row.createdAt,
        pdfUrl: row.pdfUrl,
        plan: row.Subscription?.Plan.name ?? null,
        organization: {
          name: row.Organization.name,
          legalName: row.Organization.legalName,
          timezone: row.Organization.timezone,
        },
      })),
    };
  }
}
