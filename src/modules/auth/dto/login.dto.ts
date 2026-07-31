import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Ingresa tu contraseña' })
  password: string;
}
