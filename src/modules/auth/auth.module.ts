import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { SessionService } from './session.service';
import { OAuthController } from './oauth/oauth.controller';
import { AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { PendingLinkService } from './oauth/pending-link.service';
import { OAuthService } from './oauth/oauth.service';
import { TwoFactorService } from './two-factor/two-factor.service';
import { GoogleStrategy } from './oauth/oauth.strategies';
// APPLE (pausado): Sign in with Apple aún no se implementa. Descomentar para activarlo (ver ADR 011).
// import { AppleService } from './oauth/apple.service';

@Module({
  imports: [
    PrismaModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('jwt.secret') ?? 'dev-secret',
        signOptions: { expiresIn: config.get('jwt.accessExpiresIn') ?? '15m' },
      }),
    }),
  ],
  controllers: [AuthController, OAuthController, AccountController],
  providers: [
    AuthService,
    SessionService,
    JwtStrategy,
    OAuthService,
    PendingLinkService,
    AccountService,
    TwoFactorService,
    GoogleStrategy,
    // AppleService, // APPLE (pausado)
  ],
})
export class AuthModule {}
