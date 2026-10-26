import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationsService } from './notifications.service';

interface AuthedRequest {
  user: { userId: string };
}

/**
 * Campana del Hub.
 *   GET  /users/me/notifications            → últimas 30 + cantidad sin leer
 *   POST /users/me/notifications/read-all   → marcar todas como leídas
 *   POST /users/me/notifications/:id/read   → marcar una como leída
 */
@UseGuards(JwtAuthGuard)
@Controller('users/me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.notifications.list(req.user.userId);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('read-all')
  markAllRead(@Req() req: AuthedRequest) {
    return this.notifications.markAllRead(req.user.userId);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':id/read')
  markRead(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(req.user.userId, id);
  }
}
