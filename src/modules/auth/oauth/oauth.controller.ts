import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
// APPLE (pausado): también usa Body, HttpCode, NotFoundException y Post.
import { ConfigService } from '@nestjs/config';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
// APPLE (pausado): también usa CookieOptions de 'express'.
import { AuthService } from '../auth.service';
import { sessionMeta, setRefreshCookie } from '../session-cookie';
import { GoogleOAuthGuard } from './oauth.guards';
import {
  OAuthError,
  OAuthLinkRequired,
  OAuthService,
  OAuthSignupRequired,
} from './oauth.service';
import { PendingLinkService } from './pending-link.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { TwoFactorService } from '../two-factor/two-factor.service';
import {
  ConfirmPendingLinkDto,
  ConfirmSignupDto,
  PendingLinkTokenDto,
} from './pending-link.dto';
// APPLE (pausado): Sign in with Apple aún no se implementa. Descomentar para activarlo (ver ADR 011).
// import { AppleService } from './apple.service';
import type { OAuthProfile } from './oauth.types';

// /** Cookie temporal con `state.nonce` de la solicitud a Apple (10 min). */
// const APPLE_CHALLENGE_COOKIE = 'zentro_apple';
// const appleCookieOptions: CookieOptions = {
// httpOnly: true,
// // Apple vuelve con un POST desde appleid.apple.com: la cookie debe
// // enviarse en esa petición cross-site (SameSite=None exige HTTPS).
// secure: true,
// sameSite: 'none',
// path: '/api/v1/auth/oauth/apple',
// };

// interface AppleCallbackBody {
// state?: string;
// id_token?: string;
// user?: string;
// error?: string;
// }

/**
 * Inicio de sesión con Google. (Apple está comentado hasta implementarlo.)
 *   GET  /auth/oauth/providers         → qué proveedores están configurados
 *   GET  /auth/oauth/google            → redirige a Google
 *   GET  /auth/oauth/google/callback   → abre sesión y vuelve al frontend
 *   GET  /auth/oauth/pending?token=     → datos de la pantalla "Confirma que eres tú"
 *   POST /auth/oauth/pending/code       → envía código al correo de la cuenta
 *   POST /auth/oauth/pending/confirm    → contraseña o código → vincula y abre sesión
 */
const STRICT = { default: { limit: 10, ttl: 60_000 } };

@SkipThrottle()
@Controller('auth/oauth')
export class OAuthController {
  constructor(
    private readonly config: ConfigService,
    private readonly oauth: OAuthService,
    private readonly auth: AuthService,
    private readonly pending: PendingLinkService,
    private readonly twoFactor: TwoFactorService,
    private readonly notifications: NotificationsService,
    // private readonly apple: AppleService,
  ) {}

  private get frontend() {
    return this.config.get<string>('frontendUrl') ?? 'http://localhost:3000';
  }

  @Get('providers')
  providers() {
    return {
      google: Boolean(this.config.get<string>('oauth.google.clientId')),
      // apple: this.apple.enabled,
    };
  }

  /* ------------------------- Registro con Google ------------------------- */

  /** Datos para la pantalla "Crear tu cuenta con Google". */
  @Throttle(STRICT)
  @Get('signup')
  signupInfo(@Query() query: PendingLinkTokenDto) {
    const intent = this.oauth.readSignupToken(query.token);
    return {
      email: intent.email,
      name: intent.name,
      provider: intent.provider,
    };
  }

  /** Crea la cuenta y abre sesión (cookie). */
  @Throttle(STRICT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('signup/confirm')
  async signupConfirm(
    @Body() dto: ConfirmSignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.oauth.createFromSignup(dto.token, dto.name);
    const session = await this.auth.createSession(
      user.id,
      user.email,
      sessionMeta(req),
    );
    setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
  }

  /* ------------------------ Vínculo pendiente ------------------------ */

  @Throttle(STRICT)
  @Get('pending')
  pendingInfo(@Query() query: PendingLinkTokenDto) {
    return this.pending.describe(query.token);
  }

  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('pending/code')
  pendingCode(@Body() dto: PendingLinkTokenDto) {
    return this.pending.sendCode(dto.token);
  }

  /** 204 con la cookie de sesión, o 200 `{ twoFactorRequired, challenge }` si tiene 2FA. */
  @Throttle(STRICT)
  @Post('pending/confirm')
  async pendingConfirm(
    @Body() dto: ConfirmPendingLinkDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.pending.confirm(dto.token, dto);
    await this.notifications.notify(user.id, {
      type: 'SECURITY',
      title: 'Google conectado',
      body: 'Confirmaste tu identidad y vinculaste tu cuenta de Google.',
      href: '/dashboard/cuenta?tab=seguridad',
    });
    if (await this.twoFactor.isEnabled(user.id)) {
      res.status(HttpStatus.OK);
      return {
        twoFactorRequired: true,
        challenge: this.twoFactor.createChallenge(user.id),
      };
    }
    res.status(HttpStatus.NO_CONTENT);
    const session = await this.auth.createSession(
      user.id,
      user.email,
      sessionMeta(req),
    );
    // El frontend recupera la sesión con la cookie (/auth/refresh).
    setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
  }

  /* ---------------------------- Google ---------------------------- */

  @Get('google')
  @UseGuards(GoogleOAuthGuard)
  google() {
    // El guard redirige a Google.
  }

  @Get('google/callback')
  @UseGuards(GoogleOAuthGuard)
  googleCallback(@Req() req: Request, @Res() res: Response) {
    const profile = req.user as OAuthProfile | undefined;
    // Con `state` firmado, es un vínculo desde "Mi cuenta"; si no, un inicio de sesión.
    if (req.query.state) return this.finishLink(res, profile, req.query.state);
    return this.finish(req, res, profile);
  }

  /** Vincula el proveedor a la cuenta ya autenticada y vuelve a Mi cuenta. */
  private async finishLink(
    res: Response,
    profile: OAuthProfile | undefined,
    state: unknown,
  ) {
    const back = `${this.frontend}/dashboard/cuenta`;
    if (!profile) return res.redirect(`${back}?linkError=cancelled`);
    try {
      const userId = this.oauth.readLinkIntent(state, profile.provider);
      if (!userId) return res.redirect(`${back}?linkError=link_expired`);
      await this.oauth.linkToUser(userId, profile);
      await this.notifications.notify(userId, {
        type: 'SECURITY',
        title: 'Google conectado',
        body: `Ahora también puedes entrar con ${profile.email ?? 'tu cuenta de Google'}.`,
        href: '/dashboard/cuenta?tab=seguridad',
      });
      return res.redirect(`${back}?linked=${profile.provider.toLowerCase()}`);
    } catch (error) {
      const code = error instanceof OAuthError ? error.code : 'failed';
      return res.redirect(`${back}?linkError=${code}`);
    }
  }

  // /* ----------------------------- Apple ---------------------------- */

  // @Get('apple')
  // appleStart(@Res() res: Response) {
  // if (!this.apple.enabled) {
  // throw new NotFoundException(
  // 'El inicio de sesión con Apple no está configurado.',
  // );
  // }
  // const { state, nonce } = this.apple.createChallenge();
  // res.cookie(APPLE_CHALLENGE_COOKIE, `${state}.${nonce}`, {
  // ...appleCookieOptions,
  // maxAge: 10 * 60 * 1000,
  // });
  // return res.redirect(this.apple.authorizeUrl(state, nonce));
  // }

  // @Post('apple/callback')
  // @HttpCode(302)
  // async appleCallback(
  // @Body() body: AppleCallbackBody,
  // @Req() req: Request,
  // @Res() res: Response,
  // ) {
  // const cookies = req.cookies as Record<string, string | undefined>;
  // const [state, nonce] = (cookies[APPLE_CHALLENGE_COOKIE] ?? '').split('.');
  // res.clearCookie(APPLE_CHALLENGE_COOKIE, appleCookieOptions);

  // if (body.error || !body.id_token || !state || body.state !== state) {
  // return this.finish(req, res, undefined);
  // }

  // try {
  // const profile = await this.apple.verify(body.id_token, nonce, body.user);
  // return this.finish(req, res, profile);
  // } catch {
  // return res.redirect(`${this.frontend}/ingresar?oauthError=failed`);
  // }
  // }

  /* ---------------------------------------------------------------- */

  private async finish(
    req: Request,
    res: Response,
    profile: OAuthProfile | undefined,
  ) {
    // Cancelado o rechazado en el proveedor.
    if (!profile)
      return res.redirect(`${this.frontend}/ingresar?oauthError=cancelled`);

    try {
      const user = await this.oauth.resolveUser(profile);
      if (await this.twoFactor.isEnabled(user.id)) {
        const challenge = this.twoFactor.createChallenge(user.id);
        return res.redirect(
          `${this.frontend}/ingresar/verificacion?challenge=${encodeURIComponent(challenge)}`,
        );
      }
      const session = await this.auth.createSession(
        user.id,
        user.email,
        sessionMeta(req),
      );
      await this.auth.notifyLogin(user.id, sessionMeta(req));
      setRefreshCookie(res, session.refreshToken, session.refreshExpiresAt);
      // El frontend recupera la sesión con la cookie (/auth/refresh).
      return res.redirect(`${this.frontend}/dashboard`);
    } catch (error) {
      if (error instanceof OAuthSignupRequired) {
        const token = this.oauth.createSignupToken(error.profile);
        return res.redirect(
          `${this.frontend}/registrar/google?token=${encodeURIComponent(token)}`,
        );
      }
      if (error instanceof OAuthLinkRequired) {
        const token = this.pending.create(error.userId, profile);
        return res.redirect(
          `${this.frontend}/vincular-cuenta?token=${encodeURIComponent(token)}`,
        );
      }
      const code = error instanceof OAuthError ? error.code : 'failed';
      return res.redirect(`${this.frontend}/ingresar?oauthError=${code}`);
    }
  }
}
