import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Código de la app (6 dígitos) o de respaldo (XXXX-XXXX). */
const CODE = /^(\d{6}|[A-Za-z0-9]{4}-?[A-Za-z0-9]{4})$/;
const CODE_MESSAGE = 'Ingresa el código de 6 dígitos o un código de respaldo.';

export class TwoFactorCodeDto {
  @IsString()
  @Matches(CODE, { message: CODE_MESSAGE })
  code!: string;
}

export class EnableTwoFactorDto {
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos.' })
  code!: string;
}

export class DisableTwoFactorDto extends TwoFactorCodeDto {
  /** Obligatoria si la cuenta tiene contraseña. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  password?: string;
}

export class TwoFactorLoginDto extends TwoFactorCodeDto {
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  challenge!: string;
}
