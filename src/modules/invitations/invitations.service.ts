import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { DEFAULT_ROLE, ROLE_TEMPLATES, resolveCodes } from './role-templates';

const TTL_DAYS = 7;

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

type Status = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'REVOKED';

const invitationSelect = {
  id: true,
  email: true,
  status: true,
  createdAt: true,
  expiresAt: true,
  respondedAt: true,
  organizationId: true,
  Organization: { select: { name: true, slug: true, logoUrl: true } },
  Role: { select: { id: true, name: true } },
  invitedById: true,
  User_Invitation_invitedByIdToUser: { select: { name: true } },
} as const;

type InvitationRow = {
  id: string;
  email: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  respondedAt: Date | null;
  organizationId: string;
  Organization: { name: string; slug: string; logoUrl: string | null };
  Role: { id: string; name: string } | null;
  invitedById: string;
  User_Invitation_invitedByIdToUser: { name: string };
};

/**
 * Invitaciones a organizaciones (roadmap 0.2 #7).
 * - El enlace lleva un token aleatorio de 7 días; solo se guarda su hash.
 * - Solo puede aceptarla quien tenga el correo invitado. Desde el Hub se exige
 *   el correo verificado; por el enlace, recibir el correo ya lo prueba.
 * - Reinvitar al mismo correo reemplaza la invitación pendiente anterior.
 * - Los roles asignables son los perfiles de sistema de Equipo (role-templates.ts).
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly organizations: OrganizationsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Una pendiente con la fecha vencida se informa como EXPIRED. */
  private status(row: { status: string; expiresAt: Date }): Status {
    if (row.status === 'PENDING' && row.expiresAt.getTime() < Date.now())
      return 'EXPIRED';
    return row.status as Status;
  }

  private toView(row: InvitationRow) {
    return {
      id: row.id,
      email: row.email,
      status: this.status(row),
      organization: {
        id: row.organizationId,
        name: row.Organization.name,
        slug: row.Organization.slug,
        logoUrl: row.Organization.logoUrl,
      },
      role: row.Role?.name ?? DEFAULT_ROLE,
      invitedBy: row.User_Invitation_invitedByIdToUser.name,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      respondedAt: row.respondedAt,
    };
  }

  /* ----------------------------- Roles ----------------------------- */

  /**
   * Crea los perfiles de sistema que falten (los del módulo Equipo). Idempotente:
   * no toca los que ya existen ni los roles personalizados.
   */
  private async ensureSystemRoles(organizationId: string) {
    const existing = await this.prisma.role.findMany({
      where: { organizationId },
      select: { name: true },
    });
    const names = new Set(existing.map((role) => role.name));
    const missing = ROLE_TEMPLATES.filter(
      (template) => !names.has(template.name),
    );
    if (missing.length === 0) return;
    const catalog = (
      await this.prisma.permission.findMany({ select: { code: true } })
    ).map((item) => item.code);
    await this.prisma.role.createMany({
      data: missing.map((template) => ({
        organizationId,
        name: template.name,
        system: true,
        description: template.description,
        permissionCodes: resolveCodes(template, catalog),
      })),
      skipDuplicates: true,
    });
  }

  private async defaultRoleId(organizationId: string) {
    await this.ensureSystemRoles(organizationId);
    const role = await this.prisma.role.findUniqueOrThrow({
      where: { organizationId_name: { organizationId, name: DEFAULT_ROLE } },
      select: { id: true },
    });
    return role.id;
  }

  /** Roles asignables al invitar (todos menos Owner). */
  async assignableRoles(userId: string, organizationId: string) {
    await this.organizations.requirePermission(
      userId,
      organizationId,
      'INVITATIONS.MANAGE',
    );
    await this.ensureSystemRoles(organizationId);
    const roles = await this.prisma.role.findMany({
      where: { organizationId, name: { not: 'Owner' } },
      orderBy: [{ system: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, description: true },
    });
    // Mismo orden que en Equipo; los personalizados van al final.
    const order = (name: string) => {
      const index = ROLE_TEMPLATES.findIndex((item) => item.name === name);
      return index === -1 ? ROLE_TEMPLATES.length : index;
    };
    return { roles: roles.sort((a, b) => order(a.name) - order(b.name)) };
  }

  /* --------------------------- Organización --------------------------- */

  async create(
    userId: string,
    organizationId: string,
    input: { email: string; roleId?: string; message?: string },
  ) {
    await this.organizations.requirePermission(
      userId,
      organizationId,
      'INVITATIONS.MANAGE',
    );
    const email = input.email.trim().toLowerCase();

    const alreadyMember = await this.prisma.membership.findFirst({
      where: { organizationId, status: 'ACTIVE', User: { email } },
      select: { id: true },
    });
    if (alreadyMember)
      throw new ConflictException(
        'Esa persona ya es miembro de la organización.',
      );

    const roleId = input.roleId ?? (await this.defaultRoleId(organizationId));
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, organizationId },
      select: { id: true, name: true },
    });
    if (!role)
      throw new BadRequestException('Ese rol no existe en la organización.');
    if (role.name === 'Owner')
      throw new BadRequestException('No se puede invitar como Owner.');

    const token = randomBytes(32).toString('base64url');
    const [organization, inviter] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { name: true },
      }),
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { name: true },
      }),
    ]);

    const invitation = await this.prisma.$transaction(async (tx) => {
      // Reinvitar reemplaza la pendiente anterior (su enlace deja de servir).
      await tx.invitation.updateMany({
        where: { organizationId, email, status: 'PENDING' },
        data: { status: 'REVOKED', respondedAt: new Date() },
      });
      return tx.invitation.create({
        data: {
          organizationId,
          email,
          tokenHash: sha256(token),
          roleId: role.id,
          roleType: 'CUSTOM',
          message: input.message?.trim() || null,
          invitedById: userId,
          expiresAt: new Date(Date.now() + TTL_DAYS * 86_400_000),
        },
        select: invitationSelect,
      });
    });

    // Si la persona ya tiene cuenta, también le llega a la campana.
    await this.notifications.notifyEmail(email, {
      type: 'INVITATION',
      title: 'Nueva invitación',
      body: `${inviter.name} te invitó a ${organization.name} como ${role.name}.`,
      href: '/dashboard/invitaciones',
    });

    const link = `${this.config.get<string>('frontendUrl')}/invitacion?token=${token}`;
    let emailSent = true;
    try {
      await this.mail.sendInvitation(email, {
        orgName: organization.name,
        inviterName: inviter.name,
        roleName: role.name,
        message: input.message?.trim() || undefined,
        link,
      });
    } catch {
      // La invitación queda creada; se puede compartir el enlace a mano.
      emailSent = false;
    }
    return { invitation: this.toView(invitation), link, emailSent };
  }

  async listForOrganization(userId: string, organizationId: string) {
    await this.organizations.requirePermission(
      userId,
      organizationId,
      'INVITATIONS.MANAGE',
    );
    const rows = await this.prisma.invitation.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: invitationSelect,
    });
    return { invitations: rows.map((row) => this.toView(row)) };
  }

  async revoke(userId: string, organizationId: string, invitationId: string) {
    await this.organizations.requirePermission(
      userId,
      organizationId,
      'INVITATIONS.MANAGE',
    );
    const result = await this.prisma.invitation.updateMany({
      where: { id: invitationId, organizationId, status: 'PENDING' },
      data: { status: 'REVOKED', respondedAt: new Date() },
    });
    if (result.count === 0)
      throw new NotFoundException('Invitación no encontrada o ya respondida.');
  }

  /* ------------------------------ Usuario ------------------------------ */

  /** Invitaciones recibidas por mi correo (pendientes e historial). */
  async listMine(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    const rows = await this.prisma.invitation.findMany({
      where: { email: user.email.toLowerCase(), status: { not: 'REVOKED' } },
      orderBy: { createdAt: 'desc' },
      select: invitationSelect,
    });
    return { invitations: rows.map((row) => this.toView(row)) };
  }

  /** Desde el Hub (sin token): exige el correo verificado. */
  async respond(userId: string, invitationId: string, accept: boolean) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, emailVerifiedAt: true },
    });
    const row = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
      select: { ...invitationSelect, roleId: true },
    });
    if (!row || row.email !== user.email.toLowerCase())
      throw new NotFoundException('Invitación no encontrada.');
    if (accept && !user.emailVerifiedAt)
      throw new ForbiddenException(
        'Verifica tu correo en Mi cuenta para aceptar invitaciones.',
      );
    return this.finish(userId, row, accept, false);
  }

  /** Datos públicos del enlace (para la página /invitacion). */
  async preview(token: string) {
    const row = await this.findByToken(token);
    const account = await this.prisma.user.findUnique({
      where: { email: row.email },
      select: { id: true },
    });
    return { invitation: this.toView(row), accountExists: Boolean(account) };
  }

  /** Por el enlace: el correo invitado debe ser el de la sesión; lo marca verificado. */
  async respondByToken(userId: string, token: string, accept: boolean) {
    const row = await this.findByToken(token);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });
    if (row.email !== user.email.toLowerCase())
      throw new ForbiddenException(
        `Esta invitación es para ${row.email}. Inicia sesión con esa cuenta.`,
      );
    return this.finish(userId, row, accept, true);
  }

  private async findByToken(token: string) {
    const row = await this.prisma.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      select: { ...invitationSelect, roleId: true },
    });
    if (!row)
      throw new NotFoundException('La invitación no existe o fue reemplazada.');
    return row;
  }

  private async finish(
    userId: string,
    row: InvitationRow & { roleId: string | null },
    accept: boolean,
    viaEmailLink: boolean,
  ) {
    const status = this.status(row);
    if (status === 'EXPIRED')
      throw new GoneException(
        'La invitación venció. Pide que te inviten de nuevo.',
      );
    if (status !== 'PENDING')
      throw new ConflictException('Esta invitación ya fue respondida.');

    const now = new Date();
    const responder = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true },
    });
    await this.notifications.notify(row.invitedById, {
      type: 'ORGANIZATION',
      title: accept ? 'Nuevo miembro' : 'Invitación rechazada',
      body: accept
        ? `${responder.name} se unió a ${row.Organization.name} como ${row.Role?.name ?? DEFAULT_ROLE}.`
        : `${row.email} rechazó la invitación a ${row.Organization.name}.`,
      href: '/dashboard/organizaciones',
    });
    if (!accept) {
      await this.prisma.invitation.update({
        where: { id: row.id },
        data: { status: 'DECLINED', respondedAt: now },
      });
      return {
        status: 'DECLINED' as const,
        organization: this.toView(row).organization,
      };
    }

    const roleId = row.roleId ?? (await this.defaultRoleId(row.organizationId));
    await this.prisma.$transaction([
      this.prisma.invitation.update({
        where: { id: row.id },
        data: { status: 'ACCEPTED', respondedAt: now, acceptedById: userId },
      }),
      this.prisma.membership.upsert({
        where: {
          userId_organizationId: { userId, organizationId: row.organizationId },
        },
        create: {
          userId,
          organizationId: row.organizationId,
          roleId,
          status: 'ACTIVE',
        },
        update: { roleId, status: 'ACTIVE' },
      }),
      ...(viaEmailLink
        ? [
            this.prisma.user.updateMany({
              where: { id: userId, emailVerifiedAt: null },
              data: { emailVerifiedAt: now },
            }),
          ]
        : []),
    ]);
    return {
      status: 'ACCEPTED' as const,
      organization: this.toView(row).organization,
    };
  }
}
