import {
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guards de OAuth. Si el proveedor no tiene credenciales responden 404 en vez de
 * redirigir a una pantalla de error del proveedor. En el callback no lanzan
 * excepción (p. ej. si el usuario cancela): el controller decide a dónde volver.
 */
function createOAuthGuard(strategy: 'google', configKey: string) {
  @Injectable()
  class OAuthGuard extends AuthGuard(strategy) {
    constructor(readonly config: ConfigService) {
      super();
    }

    canActivate(context: ExecutionContext) {
      if (!this.config.get<string>(configKey)) {
        throw new NotFoundException(
          `El inicio de sesión con ${strategy} no está configurado.`,
        );
      }
      return super.canActivate(context);
    }

    handleRequest<TUser>(_error: unknown, user: TUser): TUser {
      return user;
    }

    /** `?intent=` (vincular desde Mi cuenta) viaja al proveedor como `state`. */
    getAuthenticateOptions(context: ExecutionContext) {
      const req = context
        .switchToHttp()
        .getRequest<{ query: Record<string, unknown> }>();
      const intent = req.query?.intent;
      return typeof intent === 'string' && intent ? { state: intent } : {};
    }
  }
  return OAuthGuard;
}

export const GoogleOAuthGuard = createOAuthGuard(
  'google',
  'oauth.google.clientId',
);
