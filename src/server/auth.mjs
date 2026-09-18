import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index === -1 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

export async function createAuth({ password }) {
  const salt = randomBytes(16);
  const expected = await scrypt(password, salt, 32);
  const sessions = new Map();

  function sweep() {
    const now = Date.now();
    for (const [token, session] of sessions) if (session.expiresAt <= now) sessions.delete(token);
  }

  async function verifyPassword(candidate) {
    if (typeof candidate !== 'string' || candidate.length > 256) return false;
    const received = await scrypt(candidate, salt, 32);
    return timingSafeEqual(expected, received);
  }

  function createSession() {
    sweep();
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
    return token;
  }

  function getSession(request) {
    sweep();
    const token = parseCookies(request.headers.cookie).workbench_session;
    const session = token ? sessions.get(token) : null;
    if (!session) return null;
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    return { token, ...session };
  }

  function destroySession(request) {
    const token = parseCookies(request.headers.cookie).workbench_session;
    if (token) sessions.delete(token);
  }

  return { verifyPassword, createSession, getSession, destroySession };
}

export const sessionCookie = (token) => `workbench_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
export const expiredSessionCookie = 'workbench_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';
