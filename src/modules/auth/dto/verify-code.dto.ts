import { IsEmail, IsNotEmpty, Matches } from 'class-validator';

export class VerifyCodeDto {
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  email: string;

  @IsNotEmpty({ message: 'Ingresa el código' })
  @Matches(/^\d{6}$/, { message: 'El código debe tener 6 dígitos' })
  code: string;
}
