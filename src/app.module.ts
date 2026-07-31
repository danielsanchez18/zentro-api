import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { MailModule } from './modules/mail/mail.module';
import { appConfig } from './config/app.config';

// Módulos de negocio (se importarán cuando existan)
// import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    PrismaModule,
    MailModule,
    HealthModule,
    AuthModule,

    // Módulos de negocio — se habilitan al implementar cada uno
    // UsersModule,
  ],
})
export class AppModule {}
