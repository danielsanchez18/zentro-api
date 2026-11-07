/**
 * Implementación mínima de TOTP (RFC 6238, SHA-1, 6 dígitos, 30 s) para Jest.
 * otplib 13 depende de `@scure/base` (solo ESM) y Jest no puede cargarlo con
 * `require` antes de Node 24.9. La app real usa el paquete verdadero; esta
 * versión es compatible con él para que las pruebas de 2FA usen códigos reales.
 */
import { createHmac, randomBytes } from 'crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30;

const base32Encode = (buffer: Buffer) => {
  let bits = '';
  for (const byte of buffer) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5)
    out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  return out;
};

const base32Decode = (text: string) => {
  let bits = '';
  for (const char of text.replace(/=+$/, '').toUpperCase())
    bits += ALPHABET.indexOf(char).toString(2).padStart(5, '0');
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};

const hotp = (secret: string, counter: number) => {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret))
    .update(message)
    .digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
};

export const generateSecret = () => base32Encode(randomBytes(20));

export const generateURI = (options: {
  issuer: string;
  label: string;
  secret: string;
}) =>
  `otpauth://totp/${encodeURIComponent(options.issuer)}:${encodeURIComponent(options.label)}?secret=${options.secret}&issuer=${encodeURIComponent(options.issuer)}`;

export const generate = (options: { secret: string; epoch?: number }) =>
  Promise.resolve(
    hotp(
      options.secret,
      Math.floor((options.epoch ?? Date.now() / 1000) / STEP),
    ),
  );

export const verify = (options: {
  secret: string;
  token: string;
  epochTolerance?: number;
  afterTimeStep?: number;
}) => {
  const now = Math.floor(Date.now() / 1000 / STEP);
  const window = Math.ceil((options.epochTolerance ?? 0) / STEP);
  for (let delta = -window; delta <= window; delta++) {
    const timeStep = now + delta;
    if (
      options.afterTimeStep !== undefined &&
      timeStep <= options.afterTimeStep
    )
      continue;
    if (hotp(options.secret, timeStep) === options.token)
      return Promise.resolve({ valid: true as const, delta, timeStep });
  }
  return Promise.resolve({ valid: false as const });
};
