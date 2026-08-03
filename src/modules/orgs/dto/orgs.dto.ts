import { IsArray, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class CreateOrgDto {
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  name: string;

  @IsString()
  @Matches(/^[a-z0-9-]+$/, {
    message: 'El slug solo admite minúsculas, números y guiones (ej: las-rocas)',
  })
  slug: string;
}

export class UpdateOrgDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  legalName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  currency?: string;
}

export class UpdateOrgFeaturesDto {
  @IsArray()
  modules: string[];

  @IsArray()
  features: string[];
}

export class UpdateOnboardingDto {
  @IsArray()
  steps: { key: string; done: boolean }[];
}