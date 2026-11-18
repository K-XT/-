import crypto from 'node:crypto';

const TTL_MS = Number(process.env.GM_SESSION_TTL_MS || 8 * 60 * 60 * 1000);
const SECRET = process.env.GM_SECRET || crypto.randomBytes(32).toString('hex');

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

export function verifyPasscode(input) {
  const expected = process.env.GM_PASSCODE || 'linghao2026';
  if (typeof input !== 'string' || typeof expected !== 'string') return false;
  const given = Buffer.from(input);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length) return false;
  return crypto.timingSafeEqual(given, wanted);
}

export function createSession(passcode) {
  if (!verifyPasscode(passcode)) return null;
  const issuedAt = Date.now();
  const expiresAt = issuedAt + TTL_MS;
  const payload = `${issuedAt.toString(36)}.${expiresAt.toString(36)}.${crypto.randomBytes(8).toString('hex')}`;
  return {
    session: `${payload}.${sign(payload)}`,
    issuedAt: new Date(issuedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    ttlMs: TTL_MS,
  };
}

export function inspectSession(token) {
  if (typeof token !== 'string') return { ok: false, reason: 'missing' };
  const parts = token.split('.');
  if (parts.length !== 4) return { ok: false, reason: 'malformed' };
  const payload = parts.slice(0, 3).join('.');
  const provided = parts[3];
  const expected = sign(payload);
  if (provided.length !== expected.length) return { ok: false, reason: 'bad_signature' };
  if (!crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected))) {
    return { ok: false, reason: 'bad_signature' };
  }
  const expiresAt = Number.parseInt(parts[1], 36);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: 'malformed' };
  if (Date.now() >= expiresAt) return { ok: false, reason: 'expired' };
  return { ok: true, expiresAt, remainingMs: expiresAt - Date.now() };
}

export function verifySession(token) {
  return inspectSession(token).ok;
}

export const SESSION_TTL_MS = TTL_MS;