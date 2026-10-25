import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class PendingLinkTokenDto {
  @IsString()
  @MinLength(20)
  @MaxLength(2000)
  token!: string;
}

/** Prueba de que la persona es dueña de la cuenta: contraseña o código. */
export class ConfirmPendingLinkDto extends PendingLinkTokenDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  password?: string;

  @IsOptional()
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos.' })
  code?: string;
}

/** Confirmación del registro con Google: el nombre se puede corregir. */
export class ConfirmSignupDto extends PendingLinkTokenDto {
  @IsString()
  @MinLength(2, { message: 'Ingresa tu nombre y apellido.' })
  @MaxLength(120)
  name!: string;
}
