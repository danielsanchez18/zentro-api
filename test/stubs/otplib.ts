/**
 * Sustituto de `otplib` solo para Jest. otplib 13 depende de `@scure/base`
 * (solo ESM) y Jest no puede cargarlo con `require` antes de Node 24.9.
 * La app real usa el paquete verdadero; las pruebas e2e no ejercitan TOTP.
 */
export const generateSecret = () => 'JBSWY3DPEHPK3PXP';
export const generateURI = (options: { issuer: string; label: string; secret: string }) =>
  `otpauth://totp/${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.label)}?secret=${options.secret}`;
export const verify = () => Promise.resolve({ valid: false as const });
