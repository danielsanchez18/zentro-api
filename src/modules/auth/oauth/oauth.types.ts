export type OAuthProvider = 'GOOGLE' | 'APPLE';

/** Perfil normalizado que devuelven las estrategias de Passport. */
export interface OAuthProfile {
  provider: OAuthProvider;
  providerId: string;
  email: string | null;
  /** El proveedor confirma que el correo pertenece a la persona. */
  emailVerified: boolean;
  name: string;
}
