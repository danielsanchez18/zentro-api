import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { StrongPassword, Trim } from '../../../common/validation';

export class RegisterDto {
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  @MaxLength(200)
  email: string;

  @IsString()
  @StrongPassword()
  password: string;

  @Trim()
  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(120, { message: 'El nombre puede tener hasta 120 caracteres' })
  name: string;
}
