import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { StrongPassword, Trim } from '../../../common/validation';

export class UpdateProfileDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres.' })
  @MaxLength(120, { message: 'El nombre puede tener hasta 120 caracteres.' })
  name?: string;

  /** null o "" borra el teléfono. */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^$|^\+?[0-9\s-]{6,30}$/, { message: 'Ingresa un teléfono válido.' })
  phone?: string;
}

/** Guía "Primeros pasos" del Hub: oculta (true) o visible (false). */
export class UpdateOnboardingDto {
  @IsBoolean()
  skipped!: boolean;
}

export class ConfirmEmailDto {
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos.' })
  code!: string;
}

export class ChangePasswordDto {
  /** Obligatoria si la cuenta ya tiene contraseña. */
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @IsString()
  @StrongPassword()
  newPassword!: string;
}

export class VerifyPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  password!: string;
}

export class UpdateNotificationPreferenceDto {
  @IsBoolean()
  emailEnabled!: boolean;
}

/** Foto ya redimensionada por el cliente; `null` la quita. Máx. ~65 KB (límite JSON de Express: 100 KB). */
export class UpdateAvatarDto {
  @IsOptional()
  @IsString()
  @MaxLength(90_000)
  @Matches(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/, {
    message: 'La imagen debe ser JPG, PNG o WebP.',
  })
  avatarUrl!: string | null;
}
