import {
  API,
  PASSWORD,
  TestContext,
  bearer,
  createTestApp,
  login,
  long,
  messageOf,
  refreshCookie,
  registerUser,
} from './helpers';

/** Registro, inicio de sesión, sesión con refresh token y recuperación de contraseña. */
describe('Auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp('auth');
  });
  afterAll(() => ctx.close());

  describe('Registro', () => {
    it('crea la cuenta, devuelve el usuario sin contraseña y deja la cookie httpOnly', async () => {
      const email = ctx.email('reg');
      const res = await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({ email, password: PASSWORD, name: 'Ana Pérez' })
        .expect(201);
      const body = res.body as {
        user: Record<string, unknown>;
        accessToken: string;
      };
      expect(body.user.email).toBe(email);
      expect(body.user.name).toBe('Ana Pérez');
      expect(body.user).not.toHaveProperty('password');
      expect(body.accessToken).toEqual(expect.any(String));
      const cookie = refreshCookie(res);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Path=/api/v1/auth');
      expect(res.body).not.toHaveProperty('refreshToken');
    });

    it('guarda el correo en minúsculas y no permite duplicarlo con otra capitalización', async () => {
      const email = ctx.email('case');
      await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({
          email: email.toUpperCase(),
          password: PASSWORD,
          name: 'Caso Mayus',
        })
        .expect(201);
      await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({ email, password: PASSWORD, name: 'Caso Mayus' })
        .expect(409);
      await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email, password: PASSWORD })
        .expect(200);
    });

    it.each([
      [
        'correo inválido',
        { email: 'no-es-correo', password: PASSWORD, name: 'Ana' },
      ],
      [
        'contraseña corta (7)',
        { email: 'x@example.test', password: 'Abc1234', name: 'Ana' },
      ],
      [
        'nombre de 1 carácter',
        { email: 'x@example.test', password: PASSWORD, name: 'A' },
      ],
      [
        'contraseña numérica (tipo)',
        { email: 'x@example.test', password: 12345678, name: 'Ana' },
      ],
      [
        'nombre numérico (tipo)',
        { email: 'x@example.test', password: PASSWORD, name: 12345 },
      ],
      ['falta el nombre', { email: 'x@example.test', password: PASSWORD }],
      [
        'campo extra no permitido',
        {
          email: 'x@example.test',
          password: PASSWORD,
          name: 'Ana',
          role: 'ADMIN',
        },
      ],
    ])('rechaza %s → 400', async (_case, body) => {
      await ctx.http().post(`${API}/auth/register`).send(body).expect(400);
    });

    it('rechaza un nombre de solo espacios → 400', async () => {
      await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({ email: ctx.email('blank'), password: PASSWORD, name: '     ' })
        .expect(400);
    });

    it('rechaza un nombre de más de 120 caracteres → 400', async () => {
      await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({
          email: ctx.email('longname'),
          password: PASSWORD,
          name: long(121),
        })
        .expect(400);
    });

    it('rechaza una contraseña de más de 72 caracteres (límite de bcrypt) → 400', async () => {
      await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({
          email: ctx.email('longpw'),
          password: `A1${long(80)}`,
          name: 'Ana',
        })
        .expect(400);
    });

    it('rechaza una contraseña sin letras y números (misma regla que al cambiarla) → 400', async () => {
      await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({
          email: ctx.email('weak'),
          password: 'solamenteletras',
          name: 'Ana',
        })
        .expect(400);
    });

    it('rechaza un correo de más de 200 caracteres → 400', async () => {
      await ctx
        .http()
        .post(`${API}/auth/register`)
        .send({
          email: `${long(200)}@example.test`,
          password: PASSWORD,
          name: 'Ana',
        })
        .expect(400);
    });
  });

  describe('check-email', () => {
    it('indica si el correo existe (200)', async () => {
      const user = await registerUser(ctx, 'check');
      await ctx
        .http()
        .post(`${API}/auth/check-email`)
        .send({ email: user.email })
        .expect(200)
        .expect({ exists: true });
      await ctx
        .http()
        .post(`${API}/auth/check-email`)
        .send({ email: ctx.email('nope') })
        .expect(200)
        .expect({ exists: false });
    });
  });

  describe('Inicio de sesión', () => {
    it('devuelve token y cookie con credenciales correctas', async () => {
      const user = await registerUser(ctx, 'login');
      const res = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      expect((res.body as { accessToken: string }).accessToken).toEqual(
        expect.any(String),
      );
      expect(refreshCookie(res)).toContain('zentro_rt=');
    });

    it('usa el mismo mensaje para contraseña incorrecta y correo inexistente (no revela cuentas)', async () => {
      const user = await registerUser(ctx, 'enum');
      const wrong = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: 'Otra12345' })
        .expect(401);
      const unknown = await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: ctx.email('ghost'), password: 'Otra12345' })
        .expect(401);
      expect(messageOf(wrong)).toBe(messageOf(unknown));
    });

    it.each([
      ['contraseña vacía', { email: 'x@example.test', password: '' }],
      ['sin contraseña', { email: 'x@example.test' }],
      ['correo inválido', { email: 'x', password: PASSWORD }],
    ])('rechaza %s → 400', async (_case, body) => {
      await ctx.http().post(`${API}/auth/login`).send(body).expect(400);
    });
  });

  describe('Sesión (access + refresh rotativo)', () => {
    it('/auth/me exige un token válido', async () => {
      const user = await registerUser(ctx, 'me');
      await ctx.http().get(`${API}/auth/me`).expect(401);
      await ctx
        .http()
        .get(`${API}/auth/me`)
        .set({ Authorization: 'Bearer basura' })
        .expect(401);
      const res = await ctx
        .http()
        .get(`${API}/auth/me`)
        .set(bearer(user))
        .expect(200);
      expect((res.body as { user: { email: string } }).user.email).toBe(
        user.email,
      );
    });

    it('refresh rota el token: el refresh anterior ya no sirve', async () => {
      const user = await registerUser(ctx, 'rotate');
      const first = await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .set('Cookie', user.cookie)
        .expect(200);
      expect(refreshCookie(first)).toContain('zentro_rt=');
      await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .set('Cookie', user.cookie)
        .expect(401);
    });

    it('logout revoca la sesión: el access token y el refresh dejan de servir', async () => {
      const user = await registerUser(ctx, 'logout');
      await ctx
        .http()
        .post(`${API}/auth/logout`)
        .set('Cookie', user.cookie)
        .expect(204);
      await ctx.http().get(`${API}/auth/me`).set(bearer(user)).expect(401);
      await ctx
        .http()
        .post(`${API}/auth/refresh`)
        .set('Cookie', user.cookie)
        .expect(401);
    });
  });

  describe('Recuperación de contraseña', () => {
    const codeFor = (email: string) =>
      [...ctx.mails]
        .reverse()
        .find((mail) => mail.to === email && mail.kind === 'reset')?.code;

    it('responde igual para un correo inexistente y no envía nada', async () => {
      const ghost = ctx.email('ghost');
      const res = await ctx
        .http()
        .post(`${API}/auth/forgot-password`)
        .send({ email: ghost })
        .expect(201);
      expect((res.body as { message: string }).message).toContain(
        'Si el correo está registrado',
      );
      expect(codeFor(ghost)).toBeUndefined();
    });

    it('envía un código de 6 dígitos, lo valida y cambia la contraseña cerrando todas las sesiones', async () => {
      const user = await registerUser(ctx, 'reset');
      await ctx
        .http()
        .post(`${API}/auth/forgot-password`)
        .send({ email: user.email })
        .expect(201);
      const code = codeFor(user.email)!;
      expect(code).toMatch(/^\d{6}$/);

      await ctx
        .http()
        .post(`${API}/auth/verify-code`)
        .send({ email: user.email, code })
        .expect(201);
      await ctx
        .http()
        .post(`${API}/auth/reset-password`)
        .send({ email: user.email, code, newPassword: 'Nueva12345' })
        .expect(201);

      await ctx.http().get(`${API}/auth/me`).set(bearer(user)).expect(401);
      await ctx
        .http()
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: PASSWORD })
        .expect(401);
      await login(ctx, user, 'Nueva12345');
      // El código es de un solo uso.
      await ctx
        .http()
        .post(`${API}/auth/reset-password`)
        .send({ email: user.email, code, newPassword: 'Otra123456' })
        .expect(400);
    });

    it('bloquea el código tras 5 intentos fallidos', async () => {
      const user = await registerUser(ctx, 'attempts');
      await ctx
        .http()
        .post(`${API}/auth/forgot-password`)
        .send({ email: user.email })
        .expect(201);
      const code = codeFor(user.email)!;
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await ctx
          .http()
          .post(`${API}/auth/verify-code`)
          .send({ email: user.email, code: wrong })
          .expect(400);
      }
      await ctx
        .http()
        .post(`${API}/auth/verify-code`)
        .send({ email: user.email, code })
        .expect(400);
    });

    it.each([
      ['código de 5 dígitos', { code: '12345', newPassword: 'Nueva12345' }],
      ['código con letras', { code: '12a456', newPassword: 'Nueva12345' }],
      ['contraseña corta', { code: '123456', newPassword: 'Ab1' }],
      [
        'contraseña sin números',
        { code: '123456', newPassword: 'solamenteletras' },
      ],
    ])('reset rechaza %s → 400', async (_case, body) => {
      await ctx
        .http()
        .post(`${API}/auth/reset-password`)
        .send({ email: ctx.email('x'), ...body })
        .expect(400);
    });
  });
});
