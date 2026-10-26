import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { OAuthService } from '../oauth/oauth.service';
import { AccountService } from './account.service';
import { TwoFactorService } from '../two-factor/two-factor.service';
import {
  DisableTwoFactorDto,
  EnableTwoFactorDto,
  TwoFactorCodeDto,
} from '../two-factor/two-factor.dto';
import {
  ChangePasswordDto,
  ConfirmEmailDto,
  UpdateAvatarDto,
  UpdateOnboardingDto,
  UpdateNotificationPreferenceDto,
  UpdateProfileDto,
  VerifyPasswordDto,
} from './account.dto';

interface AuthedRequest {
  user: { userId: string; email: string; sessionId?: string };
}

const STRICT = { default: { limit: 5, ttl: 60_000 } };

/**
 * Cuenta del usuario autenticado (`/users/me/...`).
 */
@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly oauth: OAuthService,
    private readonly config: ConfigService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  @Get()
  me(@Req() req: AuthedRequest) {
    return this.account.profile(req.user.userId);
  }

  @Patch()
  update(@Req() req: AuthedRequest, @Body() dto: UpdateProfileDto) {
    return this.account.updateProfile(req.user.userId, dto);
  }

  @Get('onboarding')
  onboarding(@Req() req: AuthedRequest) {
    return this.account.onboarding(req.user.userId);
  }

  @Put('onboarding')
  updateOnboarding(
    @Req() req: AuthedRequest,
    @Body() dto: UpdateOnboardingDto,
  ) {
    return this.account.updateOnboarding(req.user.userId, dto.skipped);
  }

  @Put('avatar')
  updateAvatar(@Req() req: AuthedRequest, @Body() dto: UpdateAvatarDto) {
    return this.account.updateAvatar(req.user.userId, dto.avatarUrl);
  }

  @Throttle(STRICT)
  @Post('email-verification')
  sendEmailVerification(@Req() req: AuthedRequest) {
    return this.account.sendEmailVerification(req.user.userId);
  }

  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  @Post('email-verification/confirm')
  confirmEmail(@Req() req: AuthedRequest, @Body() dto: ConfirmEmailDto) {
    return this.account.confirmEmailVerification(req.user.userId, dto.code);
  }

  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  @Post('password/verify')
  verifyPassword(@Req() req: AuthedRequest, @Body() dto: VerifyPasswordDto) {
    return this.account.verifyPassword(req.user.userId, dto.password);
  }

  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  @Post('password')
  changePassword(@Req() req: AuthedRequest, @Body() dto: ChangePasswordDto) {
    return this.account.changePassword(
      req.user.userId,
      req.user.sessionId,
      dto.currentPassword,
      dto.newPassword,
    );
  }

  /* -------------------- Verificación en dos pasos -------------------- */

  @Get('2fa')
  twoFactorStatus(@Req() req: AuthedRequest) {
    return this.twoFactor.status(req.user.userId);
  }

  /** Genera el secreto pendiente y su QR. */
  @Throttle(STRICT)
  @Post('2fa/setup')
  twoFactorSetup(@Req() req: AuthedRequest) {
    return this.twoFactor.setup(req.user.userId);
  }

  /** Confirma el primer código; devuelve los códigos de respaldo (una sola vez). */
  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  @Post('2fa/enable')
  twoFactorEnable(@Req() req: AuthedRequest, @Body() dto: EnableTwoFactorDto) {
    return this.twoFactor.enable(req.user.userId, dto.code);
  }

  @Throttle(STRICT)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('2fa/disable')
  twoFactorDisable(
    @Req() req: AuthedRequest,
    @Body() dto: DisableTwoFactorDto,
  ) {
    return this.twoFactor.disable(req.user.userId, dto.code, dto.password);
  }

  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  @Post('2fa/recovery-codes')
  twoFactorRecoveryCodes(
    @Req() req: AuthedRequest,
    @Body() dto: TwoFactorCodeDto,
  ) {
    return this.twoFactor.regenerateRecoveryCodes(req.user.userId, dto.code);
  }

  /* ------------------------ Métodos de acceso ------------------------ */

  @Get('identities')
  identities(@Req() req: AuthedRequest) {
    return this.account.identities(req.user.userId);
  }

  /** Devuelve la URL para vincular Google; el frontend redirige a ella. */
  @Post('identities/google/link')
  linkGoogle(@Req() req: AuthedRequest) {
    if (!this.config.get<string>('oauth.google.clientId')) {
      throw new NotFoundException(
        'El inicio de sesión con Google no está configurado.',
      );
    }
    const intent = this.oauth.createLinkIntent(req.user.userId, 'GOOGLE');
    const api = this.config.get<string>('apiPublicUrl');
    return {
      url: `${api}/api/v1/auth/oauth/google?intent=${encodeURIComponent(intent)}`,
    };
  }

  @Delete('identities/:provider')
  unlink(@Req() req: AuthedRequest, @Param('provider') provider: string) {
    return this.account.unlinkIdentity(req.user.userId, provider);
  }

  /* --------------------------- Dispositivos --------------------------- */

  @Get('sessions')
  sessions(@Req() req: AuthedRequest) {
    return this.account.sessionsList(req.user.userId, req.user.sessionId);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('sessions/:id')
  revokeSession(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.account.revokeSession(req.user.userId, id);
  }

  /** Cierra todas las sesiones excepto la actual. */
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('sessions')
  revokeOthers(@Req() req: AuthedRequest) {
    return this.account.revokeOtherSessions(
      req.user.userId,
      req.user.sessionId,
    );
  }

  /* -------------------------- Notificaciones -------------------------- */

  @Get('notification-preferences')
  notificationPreferences(@Req() req: AuthedRequest) {
    return this.account.notificationPreferences(req.user.userId);
  }

  @Patch('notification-preferences/:key')
  updateNotificationPreference(
    @Req() req: AuthedRequest,
    @Param('key') key: string,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.account.updateNotificationPreference(
      req.user.userId,
      key,
      dto.emailEnabled,
    );
  }
}
