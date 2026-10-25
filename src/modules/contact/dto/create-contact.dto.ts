import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateContactDto {
  @IsIn(['demo', 'soporte', 'alianzas', 'otro'], {
    message: 'Selecciona un motivo válido',
  })
  topic: string;

  @IsString()
  @MinLength(2, { message: 'El nombre debe tener al menos 2 caracteres' })
  @MaxLength(120, { message: 'El nombre es demasiado largo' })
  name: string;

  @IsEmail({}, { message: 'Ingresa un correo válido' })
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(160, { message: 'El nombre de la empresa es demasiado largo' })
  organization?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30, { message: 'El teléfono es demasiado largo' })
  phone?: string;

  @IsString()
  @MinLength(10, { message: 'Cuéntanos un poco más (mínimo 10 caracteres)' })
  @MaxLength(4000, { message: 'El mensaje es demasiado largo' })
  message: string;
}
