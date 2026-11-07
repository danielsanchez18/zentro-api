import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

/**
 * Smoke test de la API. Requiere DATABASE_URL (lee la base, no escribe).
 * Verifica prefijo /api/v1, validación global y errores de auth.
 */
describe('Zentro API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = configureApp(
      moduleFixture.createNestApplication<INestApplication<App>>(),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health responde ok', () =>
    request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect((res) => {
        expect((res.body as { status: string }).status).toBe('ok');
      }));

  it('POST /api/v1/auth/check-email valida el correo', () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/check-email')
      .send({ email: 'no-es-un-correo' })
      .expect(400));

  it('POST /api/v1/auth/check-email responde exists=false para un correo desconocido', () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/check-email')
      .send({ email: `no-existe-${Date.now()}@example.com` })
      .expect(200)
      .expect({ exists: false }));

  it('POST /api/v1/auth/login rechaza credenciales inválidas', () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        email: `no-existe-${Date.now()}@example.com`,
        password: 'Incorrecta123',
      })
      .expect(401));

  it('GET /api/v1/auth/me exige token', () =>
    request(app.getHttpServer()).get('/api/v1/auth/me').expect(401));

  it('POST /api/v1/auth/refresh sin cookie responde 401', () =>
    request(app.getHttpServer()).post('/api/v1/auth/refresh').expect(401));

  it('POST /api/v1/auth/logout sin sesión responde 204 y limpia la cookie', () =>
    request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .expect(204)
      .expect((res) => {
        expect(String(res.headers['set-cookie'])).toContain('zentro_rt=;');
      }));

  it('POST /api/v1/contact rechaza campos inválidos', () =>
    request(app.getHttpServer())
      .post('/api/v1/contact')
      .send({ topic: 'otro', name: 'A', email: 'x', message: 'corto' })
      .expect(400));
});
