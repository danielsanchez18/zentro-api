import { randomUUID } from 'crypto';
import {
  API,
  PASSWORD,
  TestContext,
  TestUser,
  bearer,
  createTestApp,
  login,
  long,
  registerUser,
  totp,
} from './helpers';

/** Mi cuenta: perfil, foto, verificación de correo, contraseña, accesos, sesiones, avisos y 2FA. */
describe('Mi cuenta (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp('acct');
  });
  afterAll(() => ctx.close());

  const me = (user: TestUser) =>
    ctx.http().get(`${API}/users/me`).set(bearer(user));
  const patch = (user: TestUser, body: object) =>
    ctx.http().patch(`${API}/users/me`).set(bearer(user)).send(body);

  describe('Perfil', () => {
    it('devuelve el perfil con hasPassword y sin la contraseña', async () => {
      const user = await registerUser(ctx, 'profile');
      const res = await me(user).expect(200);
      const profile = (res.body as { user: Record<string, unknown> }).user;
      expect(profile).toMatchObject({
        email: user.email,
        hasPassword: true,
        phone: null,
        avatarUrl: null,
      });
      expect(profile).not.toHaveProperty('password');
    });

    it('edita el nombre (recortando espacios) y el teléfono; "" borra el teléfono', async () => {
      const user = await registerUser(ctx, 'edit');
      await patch(user, {
        name: '  Ana María Pérez  ',
        phone: '+51 999 888 777',
      }).expect(200);
      let profile = (await me(user)).body as {
        user: { name: string; phone: string | null };
      };
      expect(profile.user).toMatchObject({
        name: 'Ana María Pérez',
        phone: '+51 999 888 777',
      });
      await patch(user, { phone: '' }).expect(200);
      profile = (await me(user)).body as {
        user: { name: string; phone: string | null };
      };
      expect(profile.user.phone).toBeNull();
    });

    it.each([
      ['nombre de 1 carácter', { name: 'A' }],
      ['nombre de 121 caracteres', { name: long(121) }],
      ['teléfono con letras', { phone: '999-ABC' }],
      ['teléfono de 31 caracteres', { phone: long(31, '9') }],
      ['teléfono muy corto', { phone: '123' }],
      ['intento de cambiar el correo', { email: 'otro@example.test' }],
      ['nombre numérico (tipo)', { name: 123456 }],
    ])('rechaza %s → 400', async (_case, body) => {
      const user = await registerUser(ctx, 'bad');
      await patch(user, body).expect(400);
    });

    it('rechaza un nombre de solo espacios → 400', async () => {
      const user = await registerUser(ctx, 'blank');
      await patch(user, { name: '     ' }).expect(400);
    });
  });

  describe('Foto de perfil', () => {
    const jpeg = `data:image/jpeg;base64,${Buffer.from('jpeg-de-prueba').toString('base64')}`;

    it('guarda una imagen JPG/PNG/WebP en data URL y null la quita', async () => {
      const user = await registerUser(ctx, 'avatar');
      await ctx
        .http()
        .put(`${API}/users/me/avatar`)
        .set(bearer(user))
        .send({ avatarUrl: jpeg })
        .expect(200);
      expect(
        ((await me(user)).body as { user: { avatarUrl: string } }).user
          .avatarUrl,
      ).toBe(jpeg);
      await ctx
        .http()
        .put(`${API}/users/me/avatar`)
        .set(bearer(user))
        .send({ avatarUrl: null })
        .expect(200);
      expect(
        ((await me(user)).body as { user: { avatarUrl: string | null } }).user
          .avatarUrl,
      ).toBeNull();
    });

    it.each([
      [
        'SVG (puede llevar scripts)',
        `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`,
      ],
      ['URL externa', 'https://example.com/foto.jpg'],
      ['javascript:', 'javascript:alert(1)'],
      [
        'más de 90 000 caracteres',
        `data:image/jpeg;base64,${long(90_001, 'A')}`,
      ],
    ])('rechaza %s → 400', async (_case, avatarUrl) => {
      const user = await registerUser(ctx, 'badavatar');
      await ctx
        .http()
        .put(`${API}/users/me/avatar`)
        .set(bearer(user))
        .send({ avatarUrl })
        .expect(400);
    });
  });

  describe('Verificar correo', () => {
    it('envía un código, rechaza uno incorrecto y verifica con el correcto; luego no reenvía', async () => {
      const user = await registerUser(ctx, 'verify');
      await ctx
        .http()
        .post(`${API}/users/me/email-verification`)
        .set(bearer(user))
        .expect(201);
      const code = [...ctx.mails]
        .reverse()
        .find(
          (mail) => mail.to === user.email && mail.kind === 'verify',
        )!.code!;
      const wrong = code === '000000' ? '111111' : '000000';
      await ctx
        .http()
        .post(`${API}/users/me/email-verification/confirm`)
        .set(bearer(user))
        .send({ code: wrong })
        .expect(400);
      const ok = await ctx
        .http()
        .post(`${API}/users/me/email-verification/confirm`)
        .set(bearer(user))
        .send({ code })
        .expect(200);
      expect(
        (ok.body as { user: { emailVerifiedAt: string } }).user.emailVerifiedAt,
      ).toEqual(expect.any(String));
      await ctx
        .http()
        .post(`${API}/users/me/email-verification`)
        .set(bearer(user))
        .expect(409);
    });

    it.each(['12345', 'abcdef', '1234567'])(
      'rechaza el código "%s" → 400',
      async (code) => {
        const user = await registerUser(ctx, 'vcode');
        await ctx
          .http()
          .post(`${API}/users/me/email-verification/confirm`)
          .set(bearer(user))
          .send({ code })
          .expect(400);
      },
    );
  });

  describe('Contraseña', () => {
    it('verifica la contraseña actual (paso 1)', async () => {
      const user = await registerUser(ctx, 'pwverify');
      await ctx
        .http()
        .post(`${API}/users/me/password/verify`)
        .set(bearer(user))
        .send({ password: 'Incorrecta1' })
        .expect(400);
      await ctx
        .http()
        .post(`${API}/users/me/password/verify`)
        .set(bearer(user))
        .send({ password: PASSWORD })
        .expect(200);
    });

    it.each([
      ['sin la contraseña actual', { newPassword: 'Nueva12345' }],
      [
        'contraseña actual incorrecta',
        { currentPassword: 'Mala12345', newPassword: 'Nueva12345' },
      ],
      [
        'nueva igual a la actual',
        { currentPassword: PASSWORD, newPassword: PASSWORD },
      ],
      [
        'nueva sin números',
        { currentPassword: PASSWORD, newPassword: 'solamenteletras' },
      ],
      [
        'nueva sin letras',
        { currentPassword: PASSWORD, newPassword: '1234567890' },
      ],
      [
        'nueva de 7 caracteres',
        { currentPassword: PASSWORD, newPassword: 'Abc1234' },
      ],
      [
        'nueva de 101 caracteres',
        { currentPassword: PASSWORD, newPassword: `A1${long(99)}` },
      ],
    ])('rechaza %s → 400', async (_case, body) => {
      const user = await registerUser(ctx, 'pwbad');
      await ctx
        .http()
        .post(`${API}/users/me/password`)
        .set(bearer(user))
        .send(body)
        .expect(400);
    });

    it('cambia la contraseña, cierra las otras sesiones (no la actual) y avisa en la campana', async () => {
      const user = await registerUser(ctx, 'pwok');
      const other = await login(ctx, user);
      await ctx
        .http()
        .post(`${API}/users/me/password`)
        .set(bearer(user))
        .send({ currentPassword: PASSWORD, newPassword: 'Nueva12345' })
        .expect(200);
      await me(user).expect(200);
      await me(other).expect(401);
      const notifications = await ctx
        .http()
        .get(`${API}/users/me/notifications`)
        .set(bearer(user))
        .expect(200);
      expect(
        (
          notifications.body as { notifications: { title: string }[] }
        ).notifications.map((item) => item.title),
      ).toContain('Contraseña actualizada');
    });
  });

  describe('Métodos de acceso', () => {
    it('lista contraseña y Google; la contraseña no se desvincula y Google sin vincular da 404', async () => {
      const user = await registerUser(ctx, 'ident');
      const res = await ctx
        .http()
        .get(`${API}/users/me/identities`)
        .set(bearer(user))
        .expect(200);
      expect(
        (res.body as { methods: { provider: string; connected: boolean }[] })
          .methods,
      ).toEqual([
        expect.objectContaining({ provider: 'PASSWORD', connected: true }),
        expect.objectContaining({ provider: 'GOOGLE', connected: false }),
      ]);
      await ctx
        .http()
        .delete(`${API}/users/me/identities/password`)
        .set(bearer(user))
        .expect(400);
      await ctx
        .http()
        .delete(`${API}/users/me/identities/google`)
        .set(bearer(user))
        .expect(404);
    });

    it('no deja desvincular Google si es el único método (cuenta sin contraseña)', async () => {
      const user = await registerUser(ctx, 'googleonly');
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { passwordSetAt: null },
      });
      await ctx.prisma.identityProvider.create({
        data: {
          userId: user.id,
          provider: 'GOOGLE',
          providerId: `e2e-${user.id}`,
          email: user.email,
        },
      });
      await ctx
        .http()
        .delete(`${API}/users/me/identities/google`)
        .set(bearer(user))
        .expect(409);
      // Al crear una contraseña (sin pedir la actual) ya se puede desvincular.
      await ctx
        .http()
        .post(`${API}/users/me/password`)
        .set(bearer(user))
        .send({ newPassword: 'Creada12345' })
        .expect(200);
      await ctx
        .http()
        .delete(`${API}/users/me/identities/google`)
        .set(bearer(user))
        .expect(200);
    });
  });

  describe('Dispositivos', () => {
    it('marca la sesión actual, cierra otra y "cerrar las demás" conserva la actual', async () => {
      const user = await registerUser(ctx, 'sessions');
      const second = await login(ctx, user);
      await login(ctx, user);
      const list = await ctx
        .http()
        .get(`${API}/users/me/sessions`)
        .set(bearer(user))
        .expect(200);
      const sessions = (
        list.body as { sessions: { id: string; current: boolean }[] }
      ).sessions;
      expect(sessions).toHaveLength(3);
      expect(sessions.filter((item) => item.current)).toHaveLength(1);

      await ctx
        .http()
        .delete(`${API}/users/me/sessions/${randomUUID()}`)
        .set(bearer(user))
        .expect(404);
      await ctx
        .http()
        .delete(`${API}/users/me/sessions`)
        .set(bearer(user))
        .expect(204);
      await me(user).expect(200);
      await me(second).expect(401);
    });

    it('no permite cerrar la sesión de otro usuario', async () => {
      const owner = await registerUser(ctx, 'sowner');
      const intruder = await registerUser(ctx, 'sintruder');
      const list = await ctx
        .http()
        .get(`${API}/users/me/sessions`)
        .set(bearer(owner))
        .expect(200);
      const id = (list.body as { sessions: { id: string }[] }).sessions[0].id;
      await ctx
        .http()
        .delete(`${API}/users/me/sessions/${id}`)
        .set(bearer(intruder))
        .expect(404);
      await me(owner).expect(200);
    });
  });

  describe('Preferencias de notificación', () => {
    it('lista los 7 avisos con obligatorios, sensibles y valores por defecto', async () => {
      const user = await registerUser(ctx, 'prefs');
      const res = await ctx
        .http()
        .get(`${API}/users/me/notification-preferences`)
        .set(bearer(user))
        .expect(200);
      const prefs = (
        res.body as {
          preferences: {
            key: string;
            required: boolean;
            sensitive: boolean;
            emailEnabled: boolean;
          }[];
        }
      ).preferences;
      expect(prefs.map((item) => item.key)).toEqual([
        'SECURITY',
        'RECOVERY',
        'INVITATIONS',
        'BILLING',
        'BILLING_REMINDERS',
        'ACTIVITY_DIGEST',
        'PRODUCT_UPDATES',
      ]);
      expect(
        prefs.filter((item) => item.required).map((item) => item.key),
      ).toEqual(['SECURITY', 'RECOVERY', 'INVITATIONS', 'BILLING']);
      expect(
        prefs.find((item) => item.key === 'BILLING_REMINDERS')?.sensitive,
      ).toBe(true);
      expect(
        prefs.find((item) => item.key === 'PRODUCT_UPDATES')?.emailEnabled,
      ).toBe(false);
    });

    it('cambia un aviso opcional y no deja apagar uno obligatorio', async () => {
      const user = await registerUser(ctx, 'prefs2');
      const res = await ctx
        .http()
        .patch(`${API}/users/me/notification-preferences/activity_digest`)
        .set(bearer(user))
        .send({ emailEnabled: false })
        .expect(200);
      expect(
        (
          res.body as { preferences: { key: string; emailEnabled: boolean }[] }
        ).preferences.find((item) => item.key === 'ACTIVITY_DIGEST')
          ?.emailEnabled,
      ).toBe(false);
      await ctx
        .http()
        .patch(`${API}/users/me/notification-preferences/security`)
        .set(bearer(user))
        .send({ emailEnabled: false })
        .expect(400);
      await ctx
        .http()
        .patch(`${API}/users/me/notification-preferences/inexistente`)
        .set(bearer(user))
        .send({ emailEnabled: false })
        .expect(404);
    });

    it.each([
      ['texto "no"', 'no'],
      ['texto "false"', 'false'],
      ['número 0', 0],
    ])(
      'rechaza emailEnabled como %s (no es booleano) → 400',
      async (_case, emailEnabled) => {
        const user = await registerUser(ctx, 'prefs3');
        await ctx
          .http()
          .patch(`${API}/users/me/notification-preferences/activity_digest`)
          .set(bearer(user))
          .send({ emailEnabled })
          .expect(400);
      },
    );
  });

  describe('Verificación en dos pasos (2FA)', () => {
    const setup = async (user: TestUser) => {
      const res = await ctx
        .http()
        .post(`${API}/users/me/2fa/setup`)
        .set(bearer(user))
        .expect(201);
      return res.body as { secret: string; otpauthUrl: string; qrCode: string };
    };

    it('no se activa sin generar el QR ni con un código incorrecto', async () => {
      const user = await registerUser(ctx, '2fa-a');
      await ctx
        .http()
        .post(`${API}/users/me/2fa/enable`)
        .set(bearer(user))
        .send({ code: '123456' })
        .expect(400);
      const { secret, otpauthUrl, qrCode } = await setup(user);
      expect(otpauthUrl).toContain('otpauth://totp/');
      expect(qrCode).toMatch(/^data:image\/png;base64,/);
      const wrong = (await totp(secret)) === '000000' ? '111111' : '000000';
      await ctx
        .http()
        .post(`${API}/users/me/2fa/enable`)
        .set(bearer(user))
        .send({ code: wrong })
        .expect(400);
      await ctx
        .http()
        .post(`${API}/users/me/2fa/enable`)
        .set(bearer(user))
        .send({ code: 'abcdef' })
        .expect(400);
    });

    it('flujo completo: activar, login con desafío, código de respaldo de un solo uso y desactivar', async () => {
      const user = await registerUser(ctx, '2fa-b');
      const { secret } = await setup(user);
      const enabled = await ctx
        .http()
        .post(`${API}/users/me/2fa/enable`)
        .set(bearer(user))
        .send({ code: await totp(secret) })
        .expect(200);
      const recoveryCodes = (enabled.body as { recoveryCodes: string[] })
        .recoveryCodes;
      expect(recoveryCodes).toHaveLength(10);
      recoveryCodes.forEach((code) =>
        expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/),
      );
      // El secreto se guarda cifrado, nunca en claro.
      const stored = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { totpSecret: true },
      });
      expect(stored.totpSecret).not.toContain(secret);
      await ctx
        .http()
        .post(`${API}/users/me/2fa/setup`)
        .set(bearer(user))
        .expect(409);

      // Login: sin sesión hasta el segundo paso.
      const first = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      const { challenge, twoFactorRequired } = first.body as {
        challenge: string;
        twoFactorRequired: boolean;
      };
      expect(twoFactorRequired).toBe(true);
      expect(first.body).not.toHaveProperty('accessToken');
      await ctx
        .http()
        .post(`${API}/auth/2fa`)
        .send({ challenge, code: '12' })
        .expect(400);
      await ctx
        .http()
        .post(`${API}/auth/2fa`)
        .send({ challenge: 'x'.repeat(30), code: '123456' })
        .expect(401);

      // Un código del siguiente periodo (el de la activación ya se usó).
      const next = await totp(secret, 30);
      await ctx
        .http()
        .post(`${API}/auth/2fa`)
        .send({ challenge, code: next })
        .expect(200);
      // No se puede reutilizar el mismo código.
      const again = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      await ctx
        .http()
        .post(`${API}/auth/2fa`)
        .send({
          challenge: (again.body as { challenge: string }).challenge,
          code: next,
        })
        .expect(400);

      // Código de respaldo: sirve una sola vez, en minúsculas y sin guion también.
      const recovery = recoveryCodes[0];
      const loose = recovery.replace('-', '').toLowerCase();
      const r1 = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      await ctx
        .http()
        .post(`${API}/auth/2fa`)
        .send({
          challenge: (r1.body as { challenge: string }).challenge,
          code: loose,
        })
        .expect(200);
      const r2 = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      await ctx
        .http()
        .post(`${API}/auth/2fa`)
        .send({
          challenge: (r2.body as { challenge: string }).challenge,
          code: recovery,
        })
        .expect(400);
      const status = await ctx
        .http()
        .get(`${API}/users/me/2fa`)
        .set(bearer(user))
        .expect(200);
      expect(status.body).toMatchObject({
        enabled: true,
        recoveryCodesLeft: 9,
      });

      // Desactivar: pide contraseña y código.
      await ctx
        .http()
        .post(`${API}/users/me/2fa/disable`)
        .set(bearer(user))
        .send({ code: recoveryCodes[1] })
        .expect(400);
      await ctx
        .http()
        .post(`${API}/users/me/2fa/disable`)
        .set(bearer(user))
        .send({ code: recoveryCodes[1], password: PASSWORD })
        .expect(204);
      const plain = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      expect(plain.body).toHaveProperty('accessToken');
    });
  });
});
