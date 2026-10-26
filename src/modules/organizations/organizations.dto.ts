import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const INDUSTRIES = [
  'RESTAURANT',
  'RETAIL',
  'SERVICE',
  'HEALTH',
  'OTHER',
] as const;
export const CAPABILITIES = [
  'ventas',
  'catalogo',
  'clientes',
  'inventario',
  'presencia',
  'finanzas',
] as const;

/** Minúsculas, números y guiones; sin guion al inicio/fin ni dobles. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class CreateOrganizationDto {
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(3, { message: 'La dirección debe tener al menos 3 caracteres.' })
  @MaxLength(40, { message: 'La dirección puede tener hasta 40 caracteres.' })
  @Matches(SLUG_PATTERN, {
    message: 'Usa solo minúsculas, números y guiones.',
  })
  slug!: string;
}

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;
}

export class SetupBranchDto {
  @IsString()
  @MinLength(2, { message: 'Cada sucursal necesita un nombre.' })
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  openingHours?: string;
}

/** Onboarding: rubro, capacidades y sucursales (0..N; reemplazan a las actuales). */
export class OrganizationSetupDto {
  @IsIn(INDUSTRIES, { message: 'Elige el rubro de tu negocio.' })
  industry!: (typeof INDUSTRIES)[number];

  @IsArray()
  @ArrayMaxSize(CAPABILITIES.length)
  @IsIn(CAPABILITIES, { each: true })
  capabilities!: (typeof CAPABILITIES)[number][];

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SetupBranchDto)
  branches!: SetupBranchDto[];
}
