import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { CheckEmailDto } from './dto/check-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { TwoFactorLoginDto } from './two-factor/two-factor.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  clearRefreshCookie,
  readRefreshCookie,
  sessionMeta,
  setRefreshCookie,
} from './session-cookie';

interface RequestWithUser {
  user: { userId: string; email: string };
}

/** Límite para endpoints sensibles a fuerza bruta / enumeración: 10 por minuto por IP. */
const STRICT = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Responde `{ user, accessToken }` y deja el refresh token en una cookie
   * httpOnly. El refresh token nunca viaja en el body.
   */
  private respondWithSession(
    res: Response,
    result: {
      user: unknown;
      accessToken: string;
      refreshToken: string;
      refreshExpiresAt: Date;
    },
  ) {
    setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
    return { user: result.user, accessToken: result.accessToken };
  }

  @Throttle(STRICT)
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respondWithSession(
      res,
      await this.authService.register(dto, sessionMeta(req)),
    );
  }

  @Throttle(STRICT)
  @Post('check-email')
  checkEmail(@Body() dto: CheckEmailDto) {
    return this.authService.checkEmail(dto.email);
  }

  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto, sessionMeta(req));
    if ('twoFactorRequired' in result) return result;
    return this.respondWithSession(res, result);
  }

  /** Segundo paso del login con 2FA: `{ challenge, code }` → sesión. */
  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  @Post('2fa')
  async twoFactor(
    @Body() dto: TwoFactorLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respondWithSession(
      res,
      await this.authService.completeTwoFactor(
        dto.challenge,
        dto.code,
        sessionMeta(req),
      ),
    );
  }

  /** Renueva el access token usando la cookie de refresh (y la rota). */
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      return this.respondWithSession(
        res,
        await this.authService.refresh(
          readRefreshCookie(req),
          sessionMeta(req),
        ),
      );
    } catch (error) {
      clearRefreshCookie(res);
      throw error;
    }
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.authService.logout(readRefreshCookie(req));
    clearRefreshCookie(res);
  }

  @Throttle(STRICT)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Throttle(STRICT)
  @Post('verify-code')
  verifyCode(@Body() dto: VerifyCodeDto) {
    return this.authService.verifyCode(dto.email, dto.code);
  }

  @Throttle(STRICT)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.email, dto.code, dto.newPassword);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: RequestWithUser) {
    return this.authService.me(req.user.userId);
  }
}
