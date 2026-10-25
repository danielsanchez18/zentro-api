import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { OAuthProfile, OAuthProvider } from './oauth.types';

export type OAuthErrorCode =
  | 'email_missing'
  | 'email_unverified'
  | 'already_linked'
  | 'link_expired'
  | 'account_exists'
  | 'email_in_use';

/** La cuenta existe y falta que su dueño confirme el vínculo (pantalla de confirmación). */
export class OAuthLinkRequired extends Error {
  constructor(readonly userId: string) {
    super('link_required');
  }
}

/** El correo no está registrado: el frontend muestra "Crear tu cuenta" antes de crearla. */
export class OAuthSignupRequired extends Error {
  constructor(readonly profile: OAuthProfile) {
    super('signup_required');
  }
}

/** Registro con proveedor pendiente de confirmar (10 min). */
interface SignupIntent {
  purpose: 'oauth-signup';
  provider: OAuthProvider;
  providerId: string;
  email: string;
  name: string;
}

export class OAuthError extends Error {
  constructor(readonly code: OAuthErrorCode) {
    super(code);
  }
}

/** Intención de vincular un proveedor a una cuenta ya autenticada (10 min). */
interface LinkIntent {
  sub: string;
  purpose: 'oauth-link';
  provider: OAuthProvider;
}

const unusablePasswordHash = () =>
  bcrypt.hash(randomBytes(32).toString('hex'), 10);

/**
 * Resuelve el usuario de un inicio de sesión con Google (y Apple, cuando se active).
 *
 * Inicio de sesión (sin intención de vínculo):
 * 1. Identidad ya vinculada (provider + providerId) → ese usuario.
 * 2. Ya existe una cuenta con ese correo pero SIN Google vinculado → no se
 *    vincula sola: `OAuthLinkRequired` lleva a la pantalla "Confirma que eres
 *    tú" (contraseña o código por correo; ver PendingLinkService).
 * 3. No existe → `OAuthSignupRequired`: el frontend muestra "Crear tu cuenta
 *    con Google" con los datos y solo al confirmar se crea la cuenta, sin
 *    contraseña (`passwordSetAt` null). El correo de Google es el principal.
 *    Solo con correos que el proveedor verificó.
 *
 * Vínculo desde "Mi cuenta" (con intención firmada): se agrega la identidad al
 * usuario autenticado aunque el correo de Google sea distinto, salvo que:
 * - esa identidad de Google ya esté vinculada a otro usuario (`already_linked`);
 * - el correo de esa cuenta de Google sea el correo de OTRA cuenta de Zentro
 *   (`email_in_use`), para no dejar a esa otra cuenta sin poder usar Google.
 */
@Injectable()
export class OAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /* --------------------------- Vínculo --------------------------- */

  createLinkIntent(userId: string, provider: OAuthProvider) {
    const payload: LinkIntent = {
      sub: userId,
      purpose: 'oauth-link',
      provider,
    };
    return this.jwt.sign(payload, {
      secret: this.config.get('jwt.secret') ?? 'dev-secret',
      expiresIn: '10m',
    });
  }

  /** Devuelve el id del usuario si `state` es una intención de vínculo válida. */
  readLinkIntent(state: unknown, provider: OAuthProvider): string | null {
    if (typeof state !== 'string' || !state) return null;
    try {
      const payload = this.jwt.verify<LinkIntent>(state, {
        secret: this.config.get('jwt.secret') ?? 'dev-secret',
      });
      if (payload.purpose !== 'oauth-link' || payload.provider !== provider) {
        throw new OAuthError('link_expired');
      }
      return payload.sub;
    } catch {
      throw new OAuthError('link_expired');
    }
  }

  async linkToUser(userId: string, profile: OAuthProfile) {
    const linked = await this.findIdentity(profile);
    if (linked) {
      if (linked.User.id !== userId) throw new OAuthError('already_linked');
      return linked.User; // ya estaba vinculada a esta misma cuenta
    }
    if (profile.email) {
      const owner = await this.prisma.user.findUnique({
        where: { email: profile.email },
        select: { id: true },
      });
      if (owner && owner.id !== userId) throw new OAuthError('email_in_use');
    }
    const current = await this.prisma.identityProvider.findFirst({
      where: { userId, provider: profile.provider },
      select: { id: true },
    });
    if (current) throw new OAuthError('already_linked');
    await this.prisma.identityProvider.create({
      data: {
        userId,
        provider: profile.provider,
        providerId: profile.providerId,
        email: profile.email,
      },
    });
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true },
    });
  }

  /* ------------------------ Inicio de sesión ------------------------ */

  async resolveUser(
    profile: OAuthProfile,
  ): Promise<{ id: string; email: string }> {
    const linked = await this.findIdentity(profile);
    if (linked) return linked.User;

    if (!profile.email) throw new OAuthError('email_missing');
    if (!profile.emailVerified) throw new OAuthError('email_unverified');

    const existing = await this.prisma.user.findUnique({
      where: { email: profile.email },
      select: { id: true },
    });
    if (existing) throw new OAuthLinkRequired(existing.id);
    throw new OAuthSignupRequired(profile);
  }

  /* ------------------------- Registro con Google ------------------------- */

  createSignupToken(profile: OAuthProfile) {
    const payload: SignupIntent = {
      purpose: 'oauth-signup',
      provider: profile.provider,
      providerId: profile.providerId,
      email: profile.email ?? '',
      name: profile.name.slice(0, 120),
    };
    return this.jwt.sign(payload, {
      secret: this.config.get('jwt.secret') ?? 'dev-secret',
      expiresIn: '10m',
    });
  }

  readSignupToken(token: string): SignupIntent {
    try {
      const payload = this.jwt.verify<SignupIntent>(token, {
        secret: this.config.get('jwt.secret') ?? 'dev-secret',
      });
      if (payload.purpose !== 'oauth-signup' || !payload.email)
        throw new Error();
      return payload;
    } catch {
      throw new BadRequestException(
        'El registro expiró. Vuelve a continuar con Google.',
      );
    }
  }

  /**
   * Crea la cuenta tras la confirmación. Cuenta nueva sin contraseña: puede
   * crear una desde "Mi cuenta" o con "¿Olvidaste tu contraseña?".
   */
  async createFromSignup(token: string, name: string) {
    const intent = this.readSignupToken(token);
    const profile: OAuthProfile = {
      provider: intent.provider,
      providerId: intent.providerId,
      email: intent.email,
      emailVerified: true,
      name,
    };
    // Pudo registrarse o vincularse mientras tanto.
    if (await this.findIdentity(profile))
      throw new ConflictException(
        'Esta cuenta de Google ya está registrada. Inicia sesión.',
      );
    if (await this.prisma.user.findUnique({ where: { email: intent.email } }))
      throw new ConflictException(
        'Ese correo ya tiene una cuenta. Inicia sesión.',
      );

    return this.prisma.user.create({
      data: {
        email: intent.email,
        name: name.trim().slice(0, 120),
        password: await unusablePasswordHash(),
        passwordSetAt: null,
        emailVerifiedAt: new Date(),
        IdentityProvider: {
          create: {
            provider: profile.provider,
            providerId: profile.providerId,
            email: profile.email,
          },
        },
      },
      select: { id: true, email: true },
    });
  }

  private findIdentity(profile: OAuthProfile) {
    return this.prisma.identityProvider.findUnique({
      where: {
        provider_providerId: {
          provider: profile.provider,
          providerId: profile.providerId,
        },
      },
      select: { User: { select: { id: true, email: true } } },
    });
  }
}
