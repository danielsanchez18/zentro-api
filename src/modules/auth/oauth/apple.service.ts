/**
 * APPLE (pausado): este servicio no está registrado en AuthModule. Se conserva
 * para activar Sign in with Apple más adelante (ver ADR 011).
 */
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { randomBytes } from 'crypto';
import type { OAuthProfile } from './oauth.types';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

/** Datos que Apple envía en `user` (solo la primera vez que el usuario autoriza). */
interface AppleUserPayload {
  name?: { firstName?: string; lastName?: string };
}

/**
 * Sign in with Apple (flujo web, `response_mode=form_post`).
 * Apple devuelve un `id_token` firmado; se verifica con sus claves públicas
 * (JWKS), el `aud` (Services ID), el emisor y el `nonce` de la solicitud.
 * No hace falta intercambiar el `code` porque solo se necesita la identidad.
 */
@Injectable()
export class AppleService {
  constructor(private readonly config: ConfigService) {}

  get clientId() {
    return this.config.get<string>('oauth.apple.clientId');
  }

  get enabled() {
    return Boolean(this.clientId);
  }

  get callbackUrl() {
    return `${this.config.get<string>('apiPublicUrl')}/api/v1/auth/oauth/apple/callback`;
  }

  /** Genera `state` (anti-CSRF) y `nonce` (anti-replay) para una solicitud. */
  createChallenge() {
    return {
      state: randomBytes(24).toString('base64url'),
      nonce: randomBytes(24).toString('base64url'),
    };
  }

  authorizeUrl(state: string, nonce: string) {
    const params = new URLSearchParams({
      client_id: this.clientId ?? '',
      redirect_uri: this.callbackUrl,
      response_type: 'code id_token',
      response_mode: 'form_post',
      scope: 'name email',
      state,
      nonce,
    });
    return `${APPLE_ISSUER}/auth/authorize?${params.toString()}`;
  }

  async verify(
    idToken: string,
    nonce: string,
    userJson?: string,
  ): Promise<OAuthProfile> {
    const { payload } = await jwtVerify(idToken, APPLE_JWKS, {
      issuer: APPLE_ISSUER,
      audience: this.clientId,
    }).catch(() => {
      throw new UnauthorizedException('Token de Apple inválido');
    });

    if (payload.nonce !== nonce) {
      throw new UnauthorizedException('Token de Apple inválido');
    }

    let name = '';
    try {
      const user = userJson
        ? (JSON.parse(userJson) as AppleUserPayload)
        : undefined;
      name = [user?.name?.firstName, user?.name?.lastName]
        .filter(Boolean)
        .join(' ');
    } catch {
      // `user` mal formado: se usa el correo como nombre
    }

    const email =
      typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
    return {
      provider: 'APPLE',
      providerId: String(payload.sub),
      email,
      // Apple marca email_verified como booleano o string "true".
      emailVerified:
        payload.email_verified === true || payload.email_verified === 'true',
      name: name || email?.split('@')[0] || 'Usuario',
    };
  }
}
