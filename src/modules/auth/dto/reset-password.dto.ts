import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';
import { StrongPassword } from '../../../common/validation';

export class ResetPasswordDto {
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  email: string;

  @IsNotEmpty({ message: 'Ingresa el código' })
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos' })
  code: string;

  @IsString()
  @StrongPassword()
  newPassword: string;
}
