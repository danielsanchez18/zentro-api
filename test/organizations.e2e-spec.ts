import { randomUUID } from 'crypto';
import {
  API,
  TestContext,
  TestUser,
  addMember,
  bearer,
  createOrg,
  createTestApp,
  long,
  registerUser,
} from './helpers';

type Org = {
  id: string;
  slug: string;
  role: string;
  plan: string;
  status: string;
  members: number;
  branches: number;
  setupStatus: string;
  trialEndsAt: string;
  capabilities: string[];
  industry: string | null;
  setupSkippedAt: string | null;
  branchList: {
    name: string;
    isPrimary: boolean;
    openingHours: string | null;
  }[];
};

/** Organizaciones (ADR 009) e invitaciones (ADR 012). */
describe('Organizaciones e invitaciones (e2e)', () => {
  let ctx: TestContext;
  let owner: TestUser;

  beforeAll(async () => {
    ctx = await createTestApp('org');
    owner = await registerUser(ctx, 'owner', { name: 'Olga Dueña' });
  });
  afterAll(() => ctx.close());

  const slug = (label: string) => `${ctx.run}-${label}`.toLowerCase();
  const createRaw = (user: TestUser, body: object) =>
    ctx.http().post(`${API}/orgs`).set(bearer(user)).send(body);

  describe('Crear organización', () => {
    it('crea con Owner, prueba de 30 días, sin sucursales y por configurar', async () => {
      const res = await createRaw(owner, {
        name: 'Café Central',
        slug: slug('cafe'),
      }).expect(201);
      const org = (res.body as { organization: Org }).organization;
      expect(org).toMatchObject({
        role: 'Owner',
        plan: 'Trial',
        status: 'TRIAL',
        members: 1,
        branches: 0,
        setupStatus: 'DRAFT',
      });
      const days =
        (new Date(org.trialEndsAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThanOrEqual(30);
    });

    it.each([
      ['nombre de 1 carácter', { name: 'A' }],
      ['nombre de 81 caracteres', { name: long(81) }],
      ['dirección con mayúsculas', { slug: 'MiNegocio' }],
      ['dirección con espacios', { slug: 'mi negocio' }],
      ['dirección con tildes', { slug: 'café' }],
      ['dirección con guion al inicio', { slug: '-negocio' }],
      ['dirección con doble guion', { slug: 'mi--negocio' }],
      ['dirección de 2 caracteres', { slug: 'ab' }],
      ['dirección de 41 caracteres', { slug: long(41) }],
      ['nombre numérico (tipo)', { name: 12345 }],
      ['campo extra', { plan: 'enterprise' }],
    ])('rechaza %s → 400', async (_case, override) => {
      await createRaw(owner, {
        name: 'Negocio',
        slug: slug('bad'),
        ...override,
      }).expect(400);
    });

    it('rechaza direcciones reservadas o en uso → 409, y slug-available lo refleja', async () => {
      await createRaw(owner, { name: 'Reservada', slug: 'dashboard' }).expect(
        409,
      );
      const taken = slug('taken');
      await createRaw(owner, { name: 'Primera', slug: taken }).expect(201);
      await createRaw(owner, { name: 'Segunda', slug: taken }).expect(409);
      await ctx
        .http()
        .get(`${API}/orgs/slug-available?slug=${taken}`)
        .set(bearer(owner))
        .expect(200)
        .expect({ available: false });
      await ctx
        .http()
        .get(`${API}/orgs/slug-available?slug=admin`)
        .set(bearer(owner))
        .expect(200)
        .expect({ available: false });
      await ctx
        .http()
        .get(`${API}/orgs/slug-available?slug=${slug('libre')}`)
        .set(bearer(owner))
        .expect(200)
        .expect({ available: true });
    });

    it('exige sesión', async () => {
      await ctx
        .http()
        .post(`${API}/orgs`)
        .send({ name: 'X', slug: slug('nosession') })
        .expect(401);
      await ctx.http().get(`${API}/orgs`).expect(401);
    });
  });

  describe('Acceso y edición', () => {
    it('solo lista mis organizaciones; un extraño recibe 404 (no revela que existe)', async () => {
      const org = await createOrg(ctx, owner, 'private');
      const stranger = await registerUser(ctx, 'stranger');
      const list = await ctx
        .http()
        .get(`${API}/orgs`)
        .set(bearer(stranger))
        .expect(200);
      expect(
        (list.body as { organizations: Org[] }).organizations,
      ).toHaveLength(0);
      await ctx
        .http()
        .get(`${API}/orgs/${org.id}`)
        .set(bearer(stranger))
        .expect(404);
      await ctx
        .http()
        .patch(`${API}/orgs/${org.id}`)
        .set(bearer(stranger))
        .send({ name: 'Hackeada' })
        .expect(404);
      await ctx
        .http()
        .get(`${API}/orgs/no-es-uuid`)
        .set(bearer(owner))
        .expect(400);
      await ctx
        .http()
        .get(`${API}/orgs/${randomUUID()}`)
        .set(bearer(owner))
        .expect(404);
    });

    it('el Owner edita el nombre; un miembro sin ORG.UPDATE recibe 403', async () => {
      const org = await createOrg(ctx, owner, 'edit');
      await ctx
        .http()
        .patch(`${API}/orgs/${org.id}`)
        .set(bearer(owner))
        .send({ name: 'Nombre Nuevo' })
        .expect(200);
      const seller = await addMember(ctx, owner, org.id, 'Vendedor', 'seller');
      await ctx
        .http()
        .patch(`${API}/orgs/${org.id}`)
        .set(bearer(seller))
        .send({ name: 'Otro' })
        .expect(403);
      await ctx
        .http()
        .patch(`${API}/orgs/${org.id}`)
        .set(bearer(owner))
        .send({ name: 'A' })
        .expect(400);
    });
  });

  describe('Onboarding', () => {
    const setup = (user: TestUser, orgId: string, body: object) =>
      ctx.http().put(`${API}/orgs/${orgId}/setup`).set(bearer(user)).send(body);

    it('guarda rubro, capacidades y sucursales (la primera es la principal) y las reemplaza al volver a guardar', async () => {
      const org = await createOrg(ctx, owner, 'setup');
      const res = await setup(owner, org.id, {
        industry: 'RESTAURANT',
        capabilities: ['ventas', 'catalogo', 'ventas'],
        branches: [
          {
            name: 'Local Centro',
            address: 'Av. 1',
            phone: '999',
            openingHours: 'L-S 9-18',
          },
          { name: 'Local Norte' },
        ],
      }).expect(200);
      const detail = (res.body as { organization: Org }).organization;
      expect(detail).toMatchObject({
        setupStatus: 'READY',
        industry: 'RESTAURANT',
        capabilities: ['ventas', 'catalogo'],
        branches: 2,
      });
      expect(detail.branchList[0]).toMatchObject({
        name: 'Local Centro',
        isPrimary: true,
        openingHours: 'L-S 9-18',
      });
      expect(detail.branchList[1].isPrimary).toBe(false);

      const empty = await setup(owner, org.id, {
        industry: 'SERVICE',
        capabilities: [],
        branches: [],
      }).expect(200);
      expect((empty.body as { organization: Org }).organization.branches).toBe(
        0,
      );
    });

    it.each([
      [
        'rubro inexistente',
        { industry: 'MINING', capabilities: [], branches: [] },
      ],
      [
        'capacidad inexistente',
        { industry: 'RETAIL', capabilities: ['nave-espacial'], branches: [] },
      ],
      [
        'sucursal sin nombre',
        { industry: 'RETAIL', capabilities: [], branches: [{ name: 'A' }] },
      ],
      [
        'sucursal con dirección de 201 caracteres',
        {
          industry: 'RETAIL',
          capabilities: [],
          branches: [{ name: 'Local', address: long(201) }],
        },
      ],
      [
        '21 sucursales',
        {
          industry: 'RETAIL',
          capabilities: [],
          branches: Array.from({ length: 21 }, (_, i) => ({
            name: `Local ${i}`,
          })),
        },
      ],
      [
        'branches no es una lista',
        { industry: 'RETAIL', capabilities: [], branches: 'Local' },
      ],
    ])('rechaza %s → 400', async (_case, body) => {
      const org = await createOrg(
        ctx,
        owner,
        `setbad${Math.random().toString(36).slice(2, 6)}`,
      );
      await setup(owner, org.id, body).expect(400);
    });

    it('"Configurar después" deja la organización pendiente con fecha', async () => {
      const org = await createOrg(ctx, owner, 'skip');
      const res = await ctx
        .http()
        .post(`${API}/orgs/${org.id}/setup/skip`)
        .set(bearer(owner))
        .expect(200);
      expect((res.body as { organization: Org }).organization).toMatchObject({
        setupStatus: 'DRAFT',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- matcher de Jest
        setupSkippedAt: expect.any(String),
      });
    });

    it('la guía del Hub se oculta y se vuelve a mostrar', async () => {
      await ctx
        .http()
        .put(`${API}/users/me/onboarding`)
        .set(bearer(owner))
        .send({ skipped: true })
        .expect(200);
      expect(
        (
          (
            await ctx
              .http()
              .get(`${API}/users/me/onboarding`)
              .set(bearer(owner))
          ).body as { skippedAt: string | null }
        ).skippedAt,
      ).toEqual(expect.any(String));
      await ctx
        .http()
        .put(`${API}/users/me/onboarding`)
        .set(bearer(owner))
        .send({ skipped: false })
        .expect(200);
      await ctx
        .http()
        .put(`${API}/users/me/onboarding`)
        .set(bearer(owner))
        .send({ skipped: 'si' })
        .expect(400);
    });
  });

  describe('Invitaciones', () => {
    let org: { id: string };
    const roles = async () =>
      (
        (
          await ctx
            .http()
            .get(`${API}/orgs/${org.id}/roles`)
            .set(bearer(owner))
            .expect(200)
        ).body as { roles: { id: string; name: string }[] }
      ).roles;
    const invite = (body: object, user = owner) =>
      ctx
        .http()
        .post(`${API}/orgs/${org.id}/invitations`)
        .set(bearer(user))
        .send(body);
    const tokenOf = (res: { body: unknown }) =>
      new URL((res.body as { link: string }).link).searchParams.get('token')!;

    beforeAll(async () => {
      org = await createOrg(ctx, owner, 'inv');
    });

    it('ofrece los 6 perfiles de Equipo en orden y nunca Owner', async () => {
      expect((await roles()).map((role) => role.name)).toEqual([
        'Administrador',
        'Vendedor',
        'Cajero',
        'Contador',
        'Inventario y compras',
        'Contenido y canales',
      ]);
    });

    it('invita con rol y mensaje, envía el correo con el enlace y avisa en la campana del invitado', async () => {
      const guest = await registerUser(ctx, 'guest');
      const cashier = (await roles()).find((role) => role.name === 'Cajero')!;
      const res = await invite({
        email: guest.email.toUpperCase(),
        roleId: cashier.id,
        message: '¡Bienvenido!',
      }).expect(201);
      const body = res.body as {
        invitation: { email: string; role: string; status: string };
        emailSent: boolean;
      };
      expect(body.invitation).toMatchObject({
        email: guest.email,
        role: 'Cajero',
        status: 'PENDING',
      });
      expect(body.emailSent).toBe(true);
      const mail = [...ctx.mails]
        .reverse()
        .find((item) => item.kind === 'invitation' && item.to === guest.email);
      expect(mail).toMatchObject({ message: '¡Bienvenido!' });
      expect(mail?.link).toContain('/invitacion?token=');
      const bell = await ctx
        .http()
        .get(`${API}/users/me/notifications`)
        .set(bearer(guest))
        .expect(200);
      expect(
        (bell.body as { notifications: { type: string; body: string }[] })
          .notifications[0],
      ).toMatchObject({
        type: 'INVITATION',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- matcher de Jest
        body: expect.stringContaining('como Cajero'),
      });
    });

    it.each([
      ['correo inválido', { email: 'no-es-correo' }],
      [
        'mensaje de 501 caracteres',
        { email: 'x@example.test', message: long(501) },
      ],
      ['roleId que no es UUID', { email: 'x@example.test', roleId: 'cajero' }],
      ['mensaje numérico (tipo)', { email: 'x@example.test', message: 123 }],
    ])('rechaza %s → 400', async (_case, body) => {
      await invite(body).expect(400);
    });

    it('rechaza invitar como Owner o con un rol de otra organización', async () => {
      const ownerRole = await ctx.prisma.role.findFirstOrThrow({
        where: { organizationId: org.id, name: 'Owner' },
      });
      await invite({ email: ctx.email('x'), roleId: ownerRole.id }).expect(400);
      const otherOrg = await createOrg(ctx, owner, 'otherroles');
      const foreign = (
        (
          await ctx
            .http()
            .get(`${API}/orgs/${otherOrg.id}/roles`)
            .set(bearer(owner))
        ).body as { roles: { id: string }[] }
      ).roles[0];
      await invite({ email: ctx.email('x'), roleId: foreign.id }).expect(400);
    });

    it('la vista previa del enlace es pública; un token inválido da 404 y uno corto 400', async () => {
      const res = await invite({ email: ctx.email('preview') }).expect(201);
      const preview = await ctx
        .http()
        .post(`${API}/invitations/token/preview`)
        .send({ token: tokenOf(res) })
        .expect(200);
      expect(
        preview.body as {
          invitation: { role: string; status: string };
          accountExists: boolean;
        },
      ).toMatchObject({
        invitation: { role: 'Vendedor', status: 'PENDING' },
        accountExists: false,
      });
      await ctx
        .http()
        .post(`${API}/invitations/token/preview`)
        .send({ token: 'x'.repeat(43) })
        .expect(404);
      await ctx
        .http()
        .post(`${API}/invitations/token/preview`)
        .send({ token: 'corto' })
        .expect(400);
    });

    it('solo acepta el dueño del correo; al aceptar queda miembro con su rol y el correo verificado', async () => {
      const guest = await registerUser(ctx, 'accept');
      const other = await registerUser(ctx, 'notme');
      const token = tokenOf(await invite({ email: guest.email }).expect(201));
      await ctx
        .http()
        .post(`${API}/invitations/token/respond`)
        .set(bearer(other))
        .send({ token, accept: true })
        .expect(403);
      await ctx
        .http()
        .post(`${API}/invitations/token/respond`)
        .send({ token, accept: true })
        .expect(401);
      const res = await ctx
        .http()
        .post(`${API}/invitations/token/respond`)
        .set(bearer(guest))
        .send({ token, accept: true })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'ACCEPTED' });
      await ctx
        .http()
        .post(`${API}/invitations/token/respond`)
        .set(bearer(guest))
        .send({ token, accept: true })
        .expect(409);

      const orgs = await ctx
        .http()
        .get(`${API}/orgs`)
        .set(bearer(guest))
        .expect(200);
      expect(
        (orgs.body as { organizations: Org[] }).organizations.find(
          (item) => item.id === org.id,
        )?.role,
      ).toBe('Vendedor');
      const profile = await ctx
        .http()
        .get(`${API}/users/me`)
        .set(bearer(guest))
        .expect(200);
      expect(
        (profile.body as { user: { emailVerifiedAt: string | null } }).user
          .emailVerifiedAt,
      ).not.toBeNull();
      // El Owner recibe el aviso.
      const bell = await ctx
        .http()
        .get(`${API}/users/me/notifications`)
        .set(bearer(owner))
        .expect(200);
      expect(
        (bell.body as { notifications: { title: string }[] }).notifications.map(
          (item) => item.title,
        ),
      ).toContain('Nuevo miembro');
      // Ya es miembro: no se le puede volver a invitar.
      await invite({ email: guest.email }).expect(409);
    });

    it('desde el Hub exige correo verificado para aceptar, pero deja rechazar', async () => {
      const guest = await registerUser(ctx, 'hub');
      const res = await invite({ email: guest.email }).expect(201);
      const id = (res.body as { invitation: { id: string } }).invitation.id;
      const mine = await ctx
        .http()
        .get(`${API}/invitations`)
        .set(bearer(guest))
        .expect(200);
      expect(
        (mine.body as { invitations: { id: string }[] }).invitations.map(
          (item) => item.id,
        ),
      ).toContain(id);
      await ctx
        .http()
        .post(`${API}/invitations/${id}/respond`)
        .set(bearer(guest))
        .send({ accept: true })
        .expect(403);
      await ctx
        .http()
        .post(`${API}/invitations/${id}/respond`)
        .set(bearer(guest))
        .send({ accept: 'si' })
        .expect(400);
      const declined = await ctx
        .http()
        .post(`${API}/invitations/${id}/respond`)
        .set(bearer(guest))
        .send({ accept: false })
        .expect(200);
      expect(declined.body).toMatchObject({ status: 'DECLINED' });
    });

    it('nadie puede responder la invitación de otro desde el Hub', async () => {
      const guest = await registerUser(ctx, 'victim');
      const intruder = await registerUser(ctx, 'intruder');
      const res = await invite({ email: guest.email }).expect(201);
      const id = (res.body as { invitation: { id: string } }).invitation.id;
      await ctx
        .http()
        .post(`${API}/invitations/${id}/respond`)
        .set(bearer(intruder))
        .send({ accept: false })
        .expect(404);
    });

    it('reinvitar anula el enlace anterior; revocar funciona una sola vez', async () => {
      const email = ctx.email('reinvite');
      const first = tokenOf(await invite({ email }).expect(201));
      const second = await invite({ email }).expect(201);
      const preview = await ctx
        .http()
        .post(`${API}/invitations/token/preview`)
        .send({ token: first })
        .expect(200);
      expect(
        (preview.body as { invitation: { status: string } }).invitation.status,
      ).toBe('REVOKED');
      const id = (second.body as { invitation: { id: string } }).invitation.id;
      await ctx
        .http()
        .delete(`${API}/orgs/${org.id}/invitations/${id}`)
        .set(bearer(owner))
        .expect(204);
      await ctx
        .http()
        .delete(`${API}/orgs/${org.id}/invitations/${id}`)
        .set(bearer(owner))
        .expect(404);
    });

    it('una invitación vencida no se puede aceptar (410) y se lista como EXPIRED', async () => {
      const guest = await registerUser(ctx, 'expired');
      const res = await invite({ email: guest.email }).expect(201);
      const id = (res.body as { invitation: { id: string } }).invitation.id;
      await ctx.prisma.invitation.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await ctx
        .http()
        .post(`${API}/invitations/token/respond`)
        .set(bearer(guest))
        .send({ token: tokenOf(res), accept: true })
        .expect(410);
      const mine = await ctx
        .http()
        .get(`${API}/invitations`)
        .set(bearer(guest))
        .expect(200);
      expect(
        (
          mine.body as { invitations: { id: string; status: string }[] }
        ).invitations.find((item) => item.id === id)?.status,
      ).toBe('EXPIRED');
    });

    it('un miembro sin INVITATIONS.MANAGE no puede invitar, listar ni revocar', async () => {
      const seller = await addMember(
        ctx,
        owner,
        org.id,
        'Vendedor',
        'noinvite',
      );
      await invite({ email: ctx.email('x') }, seller).expect(403);
      await ctx
        .http()
        .get(`${API}/orgs/${org.id}/invitations`)
        .set(bearer(seller))
        .expect(403);
      await ctx
        .http()
        .get(`${API}/orgs/${org.id}/roles`)
        .set(bearer(seller))
        .expect(403);
    });

    it('un Administrador sí puede invitar', async () => {
      const admin = await addMember(
        ctx,
        owner,
        org.id,
        'Administrador',
        'admin',
      );
      await invite({ email: ctx.email('byadmin') }, admin).expect(201);
    });
  });
});
