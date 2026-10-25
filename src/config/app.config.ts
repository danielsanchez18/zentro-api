// Configuración global de la aplicación
// Las variables de entorno se cargan desde ConfigModule (@nestjs/config)

export const appConfig = () => ({
  port: parseInt(process.env.PORT ?? '4000', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  // URL pública de esta API (para los callbacks de OAuth).
  apiPublicUrl: process.env.API_PUBLIC_URL ?? 'http://localhost:4000',
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'super-secret-change-in-production',
    // Access token corto; la sesión se mantiene con el refresh token rotativo.
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
  },
  twoFactor: {
    // Clave para cifrar los secretos TOTP (cualquier texto largo y aleatorio).
    // Si falta se deriva de JWT_SECRET (solo aceptable en desarrollo).
    encryptionKey: process.env.TWO_FACTOR_KEY,
    issuer: process.env.TWO_FACTOR_ISSUER ?? 'Zentro',
  },
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
    // APPLE (pausado): Sign in with Apple aún no se implementa.
    // apple: {
    //   // Services ID de "Sign in with Apple" (p. ej. pe.zentro.web)
    //   clientId: process.env.APPLE_CLIENT_ID,
    // },
  },
  session: {
    // Vida del refresh token (cookie httpOnly). Se renueva en cada /auth/refresh.
    refreshTtlDays: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS ?? '30', 10),
  },
  mail: {
    driver: process.env.MAIL_DRIVER ?? 'log',
    resendApiKey: process.env.RESEND_API_KEY,
    fromName: process.env.MAIL_FROM_NAME ?? 'Zentro',
    fromEmail: process.env.MAIL_FROM_EMAIL ?? 'onboarding@resend.dev',
    // Destino de las notificaciones del formulario de contacto
    contactTo: process.env.MAIL_CONTACT_TO ?? 'usezentroapp@gmail.com',
  },
  resetCode: {
    ttlMinutes: parseInt(process.env.RESET_CODE_TTL_MINUTES ?? '15', 10),
    maxAttempts: parseInt(process.env.RESET_CODE_MAX_ATTEMPTS ?? '5', 10),
  },
});
