import 'dotenv/config';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { MailService } from '../src/modules/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { generate } from './stubs/otplib';

export const API = '/api/v1';
export const PASSWORD = 'Prueba123';

/** Correos capturados (MAIL_DRIVER=log + espías sobre MailService). */
export interface CapturedMail {
  to: string;
  kind: 'reset' | 'verify' | 'invitation' | 'security';
  code?: string;
  link?: string;
  message?: string;
  title?: string;
}

export interface TestContext {
  app: INestApplication<App>;
  http: () => ReturnType<typeof request>;
  prisma: PrismaService;
  mails: CapturedMail[];
  /** Prefijo único de esta corrida: todo lo creado lo lleva y se borra al final. */
  run: string;
  email: (label: string) => string;
  close: () => Promise<void>;
}

/** Levanta la app real (misma configuración que producción) contra la base de desarrollo. */
export const createTestApp = async (suite: string): Promise<TestContext> => {
  Logger.overrideLogger(['error']);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = configureApp(
    moduleRef.createNestApplication<INestApplication<App>>(),
  );
  await app.init();

  const prisma = app.get(PrismaService);
  const mail = app.get(MailService);
  const mails: CapturedMail[] = [];

  jest
    .spyOn(mail, 'sendPasswordResetCode')
    .mockImplementation((to, _name, code) => {
      mails.push({ to, kind: 'reset', code });
      return Promise.resolve();
    });
  jest
    .spyOn(mail, 'sendEmailVerificationCode')
    .mockImplementation((to, _name, code) => {
      mails.push({ to, kind: 'verify', code });
      return Promise.resolve();
    });
  jest.spyOn(mail, 'sendInvitation').mockImplementation((to, invite) => {
    mails.push({
      to,
      kind: 'invitation',
      link: invite.link,
      message: invite.message,
    });
    return Promise.resolve();
  });
  jest
    .spyOn(mail, 'sendSecurityNotice')
    .mockImplementation((to, _name, title) => {
      mails.push({ to, kind: 'security', title });
      return Promise.resolve();
    });

  const run = `e2e${suite}${Date.now().toString(36)}`;
  let counter = 0;

  const close = async () => {
    const users = await prisma.user.findMany({
      where: { email: { startsWith: `${run}.` } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);
    // Primero las organizaciones (arrastran roles, membresías, invitaciones y suscripciones).
    await prisma.organization.deleteMany({
      where: {
        OR: [
          { slug: { startsWith: run } },
          { Membership: { some: { userId: { in: ids } } } },
        ],
      },
    });
    await prisma.invitation.deleteMany({
      where: { email: { startsWith: `${run}.` } },
    });
    await prisma.passwordResetCode.deleteMany({
      where: { email: { startsWith: `${run}.` } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await app.close();
  };

  return {
    app,
    http: () => request(app.getHttpServer()),
    prisma,
    mails,
    run,
    email: (label) => `${run}.${label}.${++counter}@example.test`,
    close,
  };
};

export interface TestUser {
  id: string;
  email: string;
  password: string;
  name: string;
  token: string;
  /** Cookie `zentro_rt=...` del refresh token. */
  cookie: string;
}

export const refreshCookie = (res: request.Response) => {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  return cookies.find((item) => item.startsWith('zentro_rt=')) ?? '';
};

export const registerUser = async (
  ctx: TestContext,
  label = 'user',
  overrides: Partial<{ name: string; password: string }> = {},
): Promise<TestUser> => {
  const email = ctx.email(label);
  const name = overrides.name ?? 'Usuario Prueba';
  const password = overrides.password ?? PASSWORD;
  const res = await ctx
    .http()
    .post(`${API}/auth/register`)
    .send({ email, password, name })
    .expect(201);
  const body = res.body as { user: { id: string }; accessToken: string };
  return {
    id: body.user.id,
    email,
    password,
    name,
    token: body.accessToken,
    cookie: refreshCookie(res).split(';')[0],
  };
};

export const bearer = (user: { token: string }) => ({
  Authorization: `Bearer ${user.token}`,
});

/** Inicia otra sesión del mismo usuario (otro "dispositivo"). */
export const login = async (
  ctx: TestContext,
  user: TestUser,
  password = user.password,
) => {
  const res = await ctx
    .http()
    .post(`${API}/auth/login`)
    .send({ email: user.email, password })
    .expect(200);
  const body = res.body as { accessToken: string };
  return {
    ...user,
    token: body.accessToken,
    cookie: refreshCookie(res).split(';')[0],
  };
};

export const createOrg = async (
  ctx: TestContext,
  owner: TestUser,
  label = 'org',
) => {
  const slug = `${ctx.run}-${label}`
    .toLowerCase()
    .slice(0, 40)
    .replace(/-+$/, '');
  const res = await ctx
    .http()
    .post(`${API}/orgs`)
    .set(bearer(owner))
    .send({ name: `Org ${label}`, slug })
    .expect(201);
  return (
    res.body as { organization: { id: string; slug: string; name: string } }
  ).organization;
};

/** Invita y acepta por enlace; devuelve el usuario ya miembro. */
export const addMember = async (
  ctx: TestContext,
  owner: TestUser,
  orgId: string,
  roleName: string,
  label = 'member',
) => {
  const member = await registerUser(ctx, label);
  const roles = await ctx
    .http()
    .get(`${API}/orgs/${orgId}/roles`)
    .set(bearer(owner))
    .expect(200);
  const role = (
    roles.body as { roles: { id: string; name: string }[] }
  ).roles.find((item) => item.name === roleName)!;
  const invite = await ctx
    .http()
    .post(`${API}/orgs/${orgId}/invitations`)
    .set(bearer(owner))
    .send({ email: member.email, roleId: role.id })
    .expect(201);
  const token = new URL(
    (invite.body as { link: string }).link,
  ).searchParams.get('token')!;
  await ctx
    .http()
    .post(`${API}/invitations/token/respond`)
    .set(bearer(member))
    .send({ token, accept: true })
    .expect(200);
  return member;
};

export const totp = (secret: string, offsetSeconds = 0) =>
  generate({ secret, epoch: Math.floor(Date.now() / 1000) + offsetSeconds });

/** Mensaje(s) de error de Nest como texto (sirve para string o string[]). */
export const messageOf = (res: request.Response) => {
  const message = (res.body as { message?: string | string[] }).message;
  return Array.isArray(message) ? message.join(' | ') : (message ?? '');
};

export const long = (length: number, char = 'a') => char.repeat(length);
