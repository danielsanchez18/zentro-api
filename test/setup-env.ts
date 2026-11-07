/**
 * Entorno de las pruebas e2e (se carga antes que `dotenv`, que no pisa estas variables).
 * - MAIL_DRIVER=log: ningún correo sale a Resend; las pruebas los capturan.
 * - THROTTLE_DISABLED: sin límite por minuto (las pruebas hacen muchas peticiones).
 */
process.env.MAIL_DRIVER = 'log';
process.env.THROTTLE_DISABLED = 'true';
process.env.NODE_ENV = 'test';
