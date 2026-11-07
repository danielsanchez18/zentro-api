import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'Ingresa tu contraseña' })
  @MaxLength(200)
  password: string;
}
