import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './modules/mail/mail.module';
import { ContactModule } from './modules/contact/contact.module';
import { appConfig } from './config/app.config';

// Módulos de negocio (se importarán cuando existan)
// import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    // Rate limiting global: 100 solicitudes por minuto por IP.
    // Los endpoints sensibles de auth tienen un límite más estricto (@Throttle).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    MailModule,
    HealthModule,
    AuthModule,
    ContactModule,

    // Módulos de negocio: se habilitan al implementar cada uno
    // UsersModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
