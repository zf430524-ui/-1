import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const prefix = 'v1';

export function createSensitiveValueProtector(secret) {
  if (!secret) throw new Error('SENSITIVE_VALUE_SECRET_REQUIRED');
  const key = scryptSync(String(secret), 'study-tour-workbench-v1-sensitive-fields', 32);

  function protect(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return [prefix, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':');
  }

  function reveal(value) {
    if (!value) return '';
    const parts = String(value).split(':');
    if (parts.length !== 4 || parts[0] !== prefix) return '';
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8');
  }

  return Object.freeze({ protect, reveal });
}

export function maskDocumentNumber(value, type) {
  const text = String(value || '').trim();
  if (!text) return '';
  const visible = type === '身份证' ? 4 : Math.min(4, Math.max(2, text.length - 2));
  return `${'*'.repeat(Math.max(4, text.length - visible))}${text.slice(-visible)}`;
}
