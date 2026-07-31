import { IsEmail } from 'class-validator';

export class CheckEmailDto {
  @IsEmail({}, { message: 'Ingresa un correo válido' })
  email: string;
}
