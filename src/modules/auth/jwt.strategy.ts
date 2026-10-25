import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from './session.service';

interface JwtPayload {
  sub: string;
  email: string;
  /** Id de la sesión (UserSession) que emitió el token. */
  sid?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt.secret') ?? 'dev-secret',
    });
  }

  async validate(payload: JwtPayload) {
    // Un access token de una sesión cerrada (logout, cambio de contraseña) deja de valer.
    if (!payload.sid || !(await this.sessions.isActive(payload.sid))) {
      return null;
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true },
    });
    if (!user) {
      return null;
    }
    return { userId: user.id, email: user.email, sessionId: payload.sid };
  }
}
