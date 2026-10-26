import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateInvitationDto,
  InvitationTokenDto,
  RespondByTokenDto,
  RespondInvitationDto,
} from './invitations.dto';
import { InvitationsService } from './invitations.service';

interface AuthedRequest {
  user: { userId: string };
}

const STRICT = { default: { limit: 10, ttl: 60_000 } };

/**
 * Invitaciones de una organización (requiere INVITATIONS.MANAGE).
 *   GET    /orgs/:id/roles                  → roles asignables
 *   GET    /orgs/:id/invitations            → enviadas
 *   POST   /orgs/:id/invitations            → invitar (envía correo)
 *   DELETE /orgs/:id/invitations/:invId     → revocar
 */
@UseGuards(JwtAuthGuard)
@Controller('orgs/:orgId')
export class OrganizationInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get('roles')
  roles(
    @Req() req: AuthedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.invitations.assignableRoles(req.user.userId, orgId);
  }

  @Get('invitations')
  list(
    @Req() req: AuthedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.invitations.listForOrganization(req.user.userId, orgId);
  }

  @Throttle(STRICT)
  @Post('invitations')
  create(
    @Req() req: AuthedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitations.create(req.user.userId, orgId, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete('invitations/:invitationId')
  revoke(
    @Req() req: AuthedRequest,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitations.revoke(req.user.userId, orgId, invitationId);
  }
}

/**
 * Invitaciones recibidas.
 *   GET  /invitations                 → mis invitaciones (por mi correo)
 *   POST /invitations/:id/respond     → aceptar/rechazar desde el Hub
 *   POST /invitations/token/preview   → datos del enlace (público)
 *   POST /invitations/token/respond   → aceptar/rechazar con el enlace
 */
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  mine(@Req() req: AuthedRequest) {
    return this.invitations.listMine(req.user.userId);
  }

  // El token va en el body (no en la URL) para que no quede en logs.
  @Throttle(STRICT)
  @HttpCode(HttpStatus.OK)
  @Post('token/preview')
  preview(@Body() dto: InvitationTokenDto) {
    return this.invitations.preview(dto.token);
  }

  @Throttle(STRICT)
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('token/respond')
  respondByToken(@Req() req: AuthedRequest, @Body() dto: RespondByTokenDto) {
    return this.invitations.respondByToken(
      req.user.userId,
      dto.token,
      dto.accept,
    );
  }

  // Va después de las rutas "token/*": si no, `:id` capturaría "token".
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post(':id/respond')
  respond(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondInvitationDto,
  ) {
    return this.invitations.respond(req.user.userId, id, dto.accept);
  }
}
