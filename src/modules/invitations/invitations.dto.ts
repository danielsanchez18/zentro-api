import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Trim } from '../../common/validation';

export class CreateInvitationDto {
  @IsEmail({}, { message: 'Ingresa un correo válido.' })
  @MaxLength(200)
  email!: string;

  /** Si no se envía, se usa el perfil "Vendedor". */
  @IsOptional()
  @IsUUID()
  roleId?: string;

  /** Mensaje personalizado que va en el correo. */
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(500, { message: 'El mensaje puede tener hasta 500 caracteres.' })
  message?: string;
}

export class RespondInvitationDto {
  @IsBoolean()
  accept!: boolean;
}

export class InvitationTokenDto {
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token!: string;
}

/** Responder con el enlace: token + aceptar/rechazar. */
export class RespondByTokenDto extends InvitationTokenDto {
  @IsBoolean()
  accept!: boolean;
}
