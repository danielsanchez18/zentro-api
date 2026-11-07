import { randomUUID } from 'crypto';
import {
  API,
  TestContext,
  TestUser,
  addMember,
  bearer,
  createOrg,
  createTestApp,
  registerUser,
} from './helpers';

/** Suscripciones (solo lectura, BILLING.READ) y campana de notificaciones (ADR 013). */
describe('Suscripciones y notificaciones (e2e)', () => {
  let ctx: TestContext;
  let owner: TestUser;
  let orgId: string;

  beforeAll(async () => {
    ctx = await createTestApp('bill');
    owner = await registerUser(ctx, 'owner', { name: 'Sara Dueña' });
    orgId = (await createOrg(ctx, owner, 'shop')).id;
  });
  afterAll(() => ctx.close());

  const subscriptions = async (user: TestUser) =>
    (
      (
        await ctx
          .http()
          .get(`${API}/users/me/subscriptions`)
          .set(bearer(user))
          .expect(200)
      ).body as {
        subscriptions: {
          organization: { id: string };
          status: string;
          plan: { slug: string; price: number };
          usage: {
            users: { used: number; limit: number | null };
            branches: { used: number; limit: number | null };
          };
        }[];
      }
    ).subscriptions;
  const invoices = async (user: TestUser) =>
    (
      (
        await ctx
          .http()
          .get(`${API}/users/me/invoices`)
          .set(bearer(user))
          .expect(200)
      ).body as {
        invoices: { number: string; amount: number; status: string }[];
      }
    ).invoices;

  describe('Suscripciones y facturas', () => {
    it('el Owner ve la prueba con el uso real frente a los límites del plan', async () => {
      await addMember(ctx, owner, orgId, 'Cajero', 'cashier');
      const sub = (await subscriptions(owner)).find(
        (item) => item.organization.id === orgId,
      )!;
      expect(sub).toMatchObject({
        status: 'TRIAL',
        plan: { slug: 'trial', price: 0 },
      });
      expect(sub.usage.users).toEqual({ used: 2, limit: 3 });
      expect(sub.usage.branches).toEqual({ used: 0, limit: 1 });
    });

    it('solo quien tiene BILLING.READ ve suscripciones y facturas', async () => {
      const subscription = await ctx.prisma.subscription.findUniqueOrThrow({
        where: { organizationId: orgId },
      });
      await ctx.prisma.invoice.create({
        data: {
          organizationId: orgId,
          subscriptionId: subscription.id,
          number: `${ctx.run}-F001`,
          status: 'OPEN',
          amount: 49,
          currency: 'USD',
          dueDate: new Date(),
        },
      });
      const accountant = await addMember(
        ctx,
        owner,
        orgId,
        'Contador',
        'accountant',
      );
      const seller = await addMember(ctx, owner, orgId, 'Vendedor', 'seller');

      expect((await invoices(owner)).map((item) => item.number)).toContain(
        `${ctx.run}-F001`,
      );
      expect((await invoices(accountant)).map((item) => item.number)).toContain(
        `${ctx.run}-F001`,
      );
      expect(await subscriptions(seller)).toHaveLength(0);
      expect(await invoices(seller)).toHaveLength(0);
    });

    it('una cuenta sin organizaciones no ve nada', async () => {
      const lonely = await registerUser(ctx, 'lonely');
      expect(await subscriptions(lonely)).toHaveLength(0);
      expect(await invoices(lonely)).toHaveLength(0);
    });

    it('exige sesión', async () => {
      await ctx.http().get(`${API}/users/me/subscriptions`).expect(401);
      await ctx.http().get(`${API}/users/me/invoices`).expect(401);
    });
  });

  describe('Notificaciones', () => {
    const list = async (user: TestUser) =>
      (
        await ctx
          .http()
          .get(`${API}/users/me/notifications`)
          .set(bearer(user))
          .expect(200)
      ).body as {
        notifications: {
          id: string;
          type: string;
          title: string;
          readAt: string | null;
        }[];
        unreadCount: number;
      };

    it('un inicio de sesión genera un aviso de seguridad; el registro no', async () => {
      const user = await registerUser(ctx, 'login');
      expect((await list(user)).notifications).toHaveLength(0);
      await ctx
        .http()
        .post(`${API}/auth/login`)
        .set(
          'User-Agent',
          'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36',
        )
        .send({ email: user.email, password: user.password })
        .expect(200);
      const { notifications, unreadCount } = await list(user);
      expect(unreadCount).toBe(1);
      expect(notifications[0]).toMatchObject({
        type: 'SECURITY',
        title: 'Nuevo inicio de sesión',
      });
    });

    it('marca una como leída, no deja tocar las de otro y "marcar todo" deja 0 sin leer', async () => {
      const user = await registerUser(ctx, 'read');
      await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: user.password })
        .expect(200);
      await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: user.password })
        .expect(200);
      const before = await list(user);
      expect(before.unreadCount).toBe(2);

      const intruder = await registerUser(ctx, 'intruder');
      await ctx
        .http()
        .post(
          `${API}/users/me/notifications/${before.notifications[0].id}/read`,
        )
        .set(bearer(intruder))
        .expect(404);
      await ctx
        .http()
        .post(`${API}/users/me/notifications/no-es-uuid/read`)
        .set(bearer(user))
        .expect(400);
      await ctx
        .http()
        .post(`${API}/users/me/notifications/${randomUUID()}/read`)
        .set(bearer(user))
        .expect(404);

      await ctx
        .http()
        .post(
          `${API}/users/me/notifications/${before.notifications[0].id}/read`,
        )
        .set(bearer(user))
        .expect(204);
      // Marcar dos veces no falla (idempotente).
      await ctx
        .http()
        .post(
          `${API}/users/me/notifications/${before.notifications[0].id}/read`,
        )
        .set(bearer(user))
        .expect(204);
      expect((await list(user)).unreadCount).toBe(1);
      await ctx
        .http()
        .post(`${API}/users/me/notifications/read-all`)
        .set(bearer(user))
        .expect(204);
      expect((await list(user)).unreadCount).toBe(0);
    });

    it('devuelve como máximo 30, de la más nueva a la más antigua', async () => {
      const user = await registerUser(ctx, 'many');
      await ctx.prisma.notification.createMany({
        data: Array.from({ length: 35 }, (_, i) => ({
          userId: user.id,
          type: 'PRODUCT',
          title: `Aviso ${i}`,
          body: 'Prueba',
          createdAt: new Date(Date.now() - (35 - i) * 1000),
        })),
      });
      const { notifications, unreadCount } = await list(user);
      expect(notifications).toHaveLength(30);
      expect(unreadCount).toBe(35);
      expect(notifications[0].title).toBe('Aviso 34');
    });
  });
});
