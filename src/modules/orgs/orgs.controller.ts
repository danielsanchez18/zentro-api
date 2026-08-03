import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrgsService } from './orgs.service';
import {
  CreateOrgDto,
  UpdateOrgDto,
  UpdateOrgFeaturesDto,
} from './dto/orgs.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('orgs')
@UseGuards(JwtAuthGuard)
export class OrgsController {
  constructor(private readonly orgsService: OrgsService) {}

  /** Crea el tenant: org + Owner + sucursal principal + trial. */
  @Post()
  create(
    @CurrentUser() user: { userId: string },
    @Body() dto: CreateOrgDto,
  ) {
    return this.orgsService.create(user.userId, dto);
  }

  /** Lista las orgs del usuario. */
  @Get()
  list(@CurrentUser() user: { userId: string }) {
    return this.orgsService.listForUser(user.userId);
  }

  /** Verificación de nombre + slug (botón "Verificar" del form de creación). */
  @Get('check')
  check(
    @CurrentUser() user: { userId: string },
    @Query('name') name?: string,
    @Query('slug') slug?: string,
  ) {
    return this.orgsService.checkAvailability(user.userId, name ?? '', slug ?? '');
  }

  /** Detalle de una org. */
  @Get(':id')
  get(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.orgsService.getOrg(user.userId, id);
  }

  /** Actualiza datos generales. */
  @Patch(':id')
  update(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: UpdateOrgDto,
  ) {
    return this.orgsService.update(user.userId, id, dto);
  }

  /** Guarda rubro + módulos/features. */
  @Put(':id/features')
  updateFeatures(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: UpdateOrgFeaturesDto,
  ) {
    return this.orgsService.updateFeatures(user.userId, id, dto);
  }
}