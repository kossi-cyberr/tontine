import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Empreinte d'un jeton opaque (refresh, activation) avant stockage. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Jeton opaque aléatoire, encodé en base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Empreinte d'un code OTP à 6 chiffres avec poivre (jamais stocké en clair). */
export function hashCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(code).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

function encryptionKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** Chiffre une valeur sensible (secret TOTP, document KYC) en AES-256-GCM. */
export function encryptBuffer(plain: Buffer, secret: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBuffer(payload: Buffer, secret: string): Buffer {
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function encryptString(plain: string, secret: string): string {
  return encryptBuffer(Buffer.from(plain, 'utf8'), secret).toString('base64');
}

export function decryptString(payload: string, secret: string): string {
  return decryptBuffer(Buffer.from(payload, 'base64'), secret).toString('utf8');
}
