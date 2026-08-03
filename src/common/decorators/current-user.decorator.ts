import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUser {
  userId: string;
  email: string;
}

/**
 * Extrae el usuario autenticado inyectado por JwtStrategy (del JWT).
 * Uso: @CurrentUser() user: CurrentUser
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as CurrentUser;
  },
);