// Prisma Config — Zentro API
// La URL de la BD se lee de DATABASE_URL en .env

import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
    // Base temporal que usa `prisma migrate dev`/`migrate diff` para validar migraciones.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
