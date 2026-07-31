// Configuración global de la aplicación
// Las variables de entorno se cargan desde ConfigModule (@nestjs/config)

export const appConfig = () => ({
  port: parseInt(process.env.PORT ?? '4000', 10),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  database: {
    url: process.env.DATABASE_URL,
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'super-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  },
  mail: {
    driver: process.env.MAIL_DRIVER ?? 'log',
    resendApiKey: process.env.RESEND_API_KEY,
    fromName: process.env.MAIL_FROM_NAME ?? 'Zentro',
    fromEmail: process.env.MAIL_FROM_EMAIL ?? 'onboarding@resend.dev',
  },
  resetCode: {
    ttlMinutes: parseInt(process.env.RESET_CODE_TTL_MINUTES ?? '15', 10),
    maxAttempts: parseInt(process.env.RESET_CODE_MAX_ATTEMPTS ?? '5', 10),
  },
});
