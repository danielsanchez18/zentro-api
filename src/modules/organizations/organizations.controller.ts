import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateOrganizationDto,
  OrganizationSetupDto,
  UpdateOrganizationDto,
} from './organizations.dto';
import { OrganizationsService } from './organizations.service';

interface AuthedRequest {
  user: { userId: string };
}

/**
 * Organizaciones del usuario autenticado (Hub).
 *   GET   /orgs                     → mis organizaciones (membresías activas)
 *   GET   /orgs/slug-available      → ¿la dirección está libre?
 *   POST  /orgs                     → crear (Owner + trial 30 días, sin sucursales)
 *   GET   /orgs/:id                 → detalle con sucursales y mis permisos
 *   PATCH /orgs/:id                 → editar (ORG.UPDATE)
 *   PUT   /orgs/:id/setup           → guardar onboarding (ORG.UPDATE)
 *   POST  /orgs/:id/setup/skip      → "Configurar después" (ORG.UPDATE)
 */
@UseGuards(JwtAuthGuard)
@Controller('orgs')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.organizations.list(req.user.userId);
  }

  @Get('slug-available')
  slugAvailable(@Query('slug') slug = '') {
    return this.organizations.slugAvailable(slug);
  }

  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: CreateOrganizationDto) {
    return this.organizations.create(req.user.userId, dto);
  }

  @Get(':id')
  detail(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.organizations.detail(req.user.userId, id);
  }

  @Patch(':id')
  update(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrganizationDto,
  ) {
    return this.organizations.update(req.user.userId, id, dto);
  }

  @Put(':id/setup')
  saveSetup(
    @Req() req: AuthedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OrganizationSetupDto,
  ) {
    return this.organizations.saveSetup(req.user.userId, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/setup/skip')
  skipSetup(@Req() req: AuthedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.organizations.skipSetup(req.user.userId, id);
  }
}
