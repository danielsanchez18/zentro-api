import cookieParser from 'cookie-parser';
import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';

/**
 * Configuración global compartida por `main.ts` y los tests e2e,
 * para que ambos expongan exactamente las mismas rutas y validaciones.
 * Todas las rutas quedan como `/api/v1/...`.
 */
export function configureApp<T extends INestApplication>(app: T): T {
  // Lee la cookie httpOnly del refresh token.
  app.use(cookieParser());

  app.setGlobalPrefix('api');

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      // Sin conversión implícita: un string "false" no debe pasar como booleano
      // (Boolean("false") === true) ni un número como texto.
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  return app;
}
