import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import {
  Strategy as GoogleStrategyBase,
  Profile as GoogleProfile,
} from 'passport-google-oauth20';
import { OAuthProfile } from './oauth.types';

// Passport exige un clientID no vacío; si el proveedor no está configurado se
// registra con un valor de relleno y el guard bloquea el acceso (ver oauth.guards).
const NOT_CONFIGURED = 'not-configured';

const callbackUrl = (config: ConfigService, provider: string) =>
  `${config.get<string>('apiPublicUrl')}/api/v1/auth/oauth/${provider}/callback`;

@Injectable()
export class GoogleStrategy extends PassportStrategy(
  GoogleStrategyBase,
  'google',
) {
  constructor(config: ConfigService) {
    super({
      clientID: config.get<string>('oauth.google.clientId') || NOT_CONFIGURED,
      clientSecret:
        config.get<string>('oauth.google.clientSecret') || NOT_CONFIGURED,
      callbackURL: callbackUrl(config, 'google'),
      scope: ['email', 'profile'],
    });
  }

  validate(
    _accessToken: string,
    _refreshToken: string,
    profile: GoogleProfile,
  ): OAuthProfile {
    const email = profile.emails?.[0];
    return {
      provider: 'GOOGLE',
      providerId: profile.id,
      email: email?.value?.toLowerCase() ?? null,
      // Google solo entrega correos de cuentas verificadas.
      emailVerified: Boolean(email?.value) && email?.verified !== false,
      name: profile.displayName || email?.value?.split('@')[0] || 'Usuario',
    };
  }
}
