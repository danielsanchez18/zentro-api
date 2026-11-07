import { Transform } from 'class-transformer';
import { Matches, MaxLength, MinLength } from 'class-validator';

/** Quita espacios al inicio y al final antes de validar (así "   " no pasa un MinLength). */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/** bcrypt solo usa los primeros 72 bytes: más largo daría una falsa sensación de seguridad. */
export const PASSWORD_MAX = 72;

/**
 * Regla única de contraseñas nuevas (registro, recuperación y cambio):
 * 8 a 72 caracteres, con letras y números.
 */
export const StrongPassword = (): PropertyDecorator => (target, key) => {
  MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })(
    target,
    key,
  );
  MaxLength(PASSWORD_MAX, {
    message: `La contraseña puede tener hasta ${PASSWORD_MAX} caracteres.`,
  })(target, key);
  Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'La contraseña debe incluir letras y números.',
  })(target, key);
};
