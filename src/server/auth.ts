import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { SignJWT, jwtVerify } from 'jose';
import { z } from 'zod';
import { ApiError, baseUrl, demoAllowed, localHost, now, one, run, uid, type AppEnv, type Env } from './core';

const encoder = new TextEncoder();
const secret = (value: string | undefined) => { if (!value || value.length < 32) throw new ApiError(503, 'Configure a secret of at least 32 characters.'); return encoder.encode(value); };
export async function sign(env: Env, value: Record<string, string>, seconds: number) { return new SignJWT(value).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${seconds}s`).sign(secret(env.SESSION_SECRET)); }
export async function verify(env: Env, token: string) { return (await jwtVerify(token, secret(env.SESSION_SECRET), { algorithms: ['HS256'] })).payload; }
export async function digest(value: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(n => n.toString(16).padStart(2, '0')).join(''); }
export async function hmac(secretValue: string, value: string) { const key = await crypto.subtle.importKey('raw', encoder.encode(secretValue), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))].map(n => n.toString(16).padStart(2, '0')).join(''); }
export async function validSignature(secretValue: string, value: string | ArrayBuffer, signature: string) { if (!/^sha256=[0-9a-f]{64}$/.test(signature)) return false; const key = await crypto.subtle.importKey('raw', encoder.encode(secretValue), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']); const bytes = Uint8Array.from(signature.slice(7).match(/../g) ?? [], pair => parseInt(pair, 16)); return crypto.subtle.verify('HMAC', key, bytes, typeof value === 'string' ? encoder.encode(value) : value); }
function encode(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)); }
function decode(value: string) { return Uint8Array.from(atob(value), char => char.charCodeAt(0)); }
export async function encrypt(env: Env, value: string) { const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', secret(env.TOKEN_ENCRYPTION_KEY)), 'AES-GCM', false, ['encrypt']); const iv = crypto.getRandomValues(new Uint8Array(12)); const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(value)); return `${encode(iv)}.${encode(new Uint8Array(ciphertext))}`; }
export async function decrypt(env: Env, value: string) { const [iv, ciphertext] = value.split('.'); if (!iv || !ciphertext) throw new Error('Invalid stored credential'); const key = await crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', secret(env.TOKEN_ENCRYPTION_KEY)), 'AES-GCM', false, ['decrypt']); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, key, decode(ciphertext))); }

export const auth = new Hono<AppEnv>();
auth.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  if (c.env.DEMO_MODE === 'true' && !demoAllowed(c.env, c.req.url)) throw new ApiError(503, 'Demo mode is restricted to localhost. Disable DEMO_MODE for production.');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('Origin');
    if (origin && origin !== new URL(c.req.url).origin && origin !== baseUrl(c.env) && !(demoAllowed(c.env, c.req.url) && localHost(origin))) throw new ApiError(403, 'Invalid request origin.');
  }
  const token = getCookie(c, 'owner_session');
  if (token) {
    try { const payload = await verify(c.env, token); if (typeof payload.sid === 'string' && await one(c.env, 'SELECT id FROM sessions WHERE id=? AND expires_at>?', payload.sid, Date.now())) c.set('sessionId', payload.sid); } catch { /* Invalid sessions remain unauthenticated. */ }
  }
  await next();
});
auth.get('/api/session', c => c.json({ authenticated: !!c.get('sessionId'), demoEnabled: demoAllowed(c.env, c.req.url) }));
auth.post('/api/login', async c => {
  const input = z.object({ password: z.string().max(1000) }).parse(await c.req.json());
  if (!c.env.ADMIN_PASSWORD) throw new ApiError(503, 'ADMIN_PASSWORD is not configured.');
  const time = Date.now();
  const key = await digest(c.req.header('CF-Connecting-IP') ?? 'local');
  const attempts = await one<{ attempts: number; reset_at: number }>(c.env, 'SELECT * FROM login_attempts WHERE key=?', key);
  if (attempts && attempts.reset_at > time && attempts.attempts >= 10) throw new ApiError(429, 'Too many login attempts. Try again in 15 minutes.');
  await run(c.env, 'INSERT INTO login_attempts(key,attempts,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<? THEN excluded.reset_at ELSE reset_at END', key, time + 900000, time, time);
  if (await digest(input.password) !== await digest(c.env.ADMIN_PASSWORD)) throw new ApiError(401, 'Incorrect password.');
  const sid = uid();
  await run(c.env, 'INSERT INTO sessions(id,expires_at) VALUES(?,?)', sid, time + 7 * 86400000);
  await run(c.env, 'DELETE FROM login_attempts WHERE key=?', key);
  setCookie(c, 'owner_session', await sign(c.env, { sid }, 604800), { httpOnly: true, secure: !localHost(c.req.url), sameSite: 'Lax', path: '/', maxAge: 604800 });
  return c.json({ authenticated: true });
});
auth.post('/api/logout', async c => { if (c.get('sessionId')) await run(c.env, 'DELETE FROM sessions WHERE id=?', c.get('sessionId')); deleteCookie(c, 'owner_session', { path: '/' }); return c.json({ authenticated: false }); });
export const requireOwner = createMiddleware<AppEnv>(async (c, next) => { if (!c.get('sessionId')) throw new ApiError(401, 'Sign in to continue.'); await next(); });
