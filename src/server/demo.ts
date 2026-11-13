import { Hono } from 'hono';
import { z } from 'zod';
import { hmac } from './auth';
import { ApiError, demoAllowed, now, one, requireValue, run, statement, uid, type AccountRow, type AppEnv, type Env, type RunRow } from './core';
import { ingestSigned } from './events';
import { drain } from './engine';
import { bindNext } from './meta';

export const demo = new Hono<AppEnv>();
demo.use('/api/demo/*', async (c, next) => { if (!demoAllowed(c.env, c.req.url)) throw new ApiError(404, 'Local simulator is disabled.'); await next(); });
async function demoAccount(env: Env, id: string) { const account = requireValue(await one<AccountRow>(env, 'SELECT * FROM accounts WHERE id=?', id)); if (account.mode !== 'demo') throw new ApiError(403, 'The simulator only accepts demo accounts.'); return account; }
async function ingest(env: Env, payload: unknown) { const raw = JSON.stringify(payload); const secret = env.META_APP_SECRET ?? 'local-demo-signature-secret'; const ids = await ingestSigned(env, raw, `sha256=${await hmac(secret, raw)}`, secret); await drain(env); return ids; }
demo.post('/api/demo/seed', async c => {
  const time = await now(c.env);
  await c.env.DB.batch([
    statement(c.env, "INSERT OR IGNORE INTO accounts(id,username,name,mode) VALUES('demo-studio','northstar.studio','Northstar Studio','demo')"),
    statement(c.env, "INSERT OR IGNORE INTO accounts(id,username,name,mode) VALUES('demo-notes','fieldnotes.daily','Field Notes','demo')"),
    statement(c.env, "INSERT OR IGNORE INTO media(id,account_id,caption,type,published_at) VALUES('demo-reel-guide','demo-studio','Three simple ideas for your next creative project. Comment GUIDE for the notes.','REELS',?)", time - 86400000),
    statement(c.env, "INSERT OR IGNORE INTO media(id,account_id,caption,type,published_at) VALUES('demo-reel-notes','demo-notes','A little inspiration for your next adventure. Comment NOTES.','REELS',?)", time - 172800000),
  ]);
  return c.json({ ok: true });
});
demo.post('/api/demo/comment', async c => {
  const input = z.object({ accountId: z.string(), mediaId: z.string(), username: z.string().min(1).max(80), text: z.string().max(2000), eventId: z.string().optional(), timestamp: z.number().optional() }).parse(await c.req.json());
  await demoAccount(c.env, input.accountId);
  requireValue(await one(c.env, 'SELECT id FROM media WHERE account_id=? AND id=?', input.accountId, input.mediaId), 'Create the demo media before commenting.');
  const eventId = input.eventId ?? uid(), time = input.timestamp ?? await now(c.env);
  const ids = await ingest(c.env, { object: 'instagram', entry: [{ id: input.accountId, time, changes: [{ field: 'comments', value: { id: eventId, from: { id: `demo-user:${input.username}`, username: input.username }, media: { id: input.mediaId }, text: input.text, timestamp: time } }] }] });
  return c.json({ ok: true, eventId, ids });
});
demo.post('/api/demo/respond', async c => {
  const input = z.object({ accountId: z.string(), username: z.string(), text: z.string().max(2000).optional(), runId: z.string().optional(), buttonIndex: z.number().int().min(0).max(2).optional(), eventId: z.string().optional(), timestamp: z.number().optional(), payload: z.string().optional() }).parse(await c.req.json());
  await demoAccount(c.env, input.accountId);
  let payload = input.payload;
  if (input.buttonIndex !== undefined && !payload) {
    const journey = requireValue(await one<RunRow>(c.env, `SELECT runs.* FROM runs JOIN contacts ON contacts.id=runs.contact_id WHERE runs.account_id=? AND contacts.instagram_id=? AND runs.state IN ('running','waiting') ${input.runId ? 'AND runs.id=?' : ''} ORDER BY runs.created_at DESC LIMIT 1`, input.accountId, `demo-user:${input.username}`, ...(input.runId ? [input.runId] : [])), 'No active conversation found.');
    payload = requireValue(await one<{ token: string }>(c.env, 'SELECT token FROM response_tokens WHERE run_id=? AND node_id=? AND choice=?', journey.id, journey.node_id, input.buttonIndex), 'This button is not a response button.').token;
  }
  const eventId = input.eventId ?? uid();
  const ids = await ingest(c.env, { object: 'instagram', entry: [{ id: input.accountId, messaging: [{ sender: { id: `demo-user:${input.username}` }, recipient: { id: input.accountId }, timestamp: input.timestamp ?? await now(c.env), ...(payload ? { postback: { mid: eventId, payload, title: input.text ?? 'Button response' } } : { message: { mid: eventId, text: input.text ?? '' } }) }] }] });
  return c.json({ ok: true, eventId, ids });
});
demo.post('/api/demo/tick', async c => {
  const input = z.object({ now: z.number().int().positive().optional() }).parse(await c.req.json().catch(() => ({})));
  if (input.now !== undefined) { const time = await now(c.env); if (input.now < time - 1000) throw new ApiError(400, 'The simulation clock can only move forward.'); await run(c.env, "INSERT INTO settings(key,value) VALUES('clock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", String(input.now)); }
  await drain(c.env); return c.json({ ok: true, now: await now(c.env) });
});
demo.post('/api/demo/media', async c => {
  const input = z.object({ accountId: z.string(), id: z.string(), caption: z.string(), publishedAt: z.number().int().positive(), type: z.enum(['REELS', 'IMAGE', 'VIDEO', 'CAROUSEL_ALBUM']).default('REELS') }).parse(await c.req.json());
  await demoAccount(c.env, input.accountId);
  await run(c.env, 'INSERT INTO media(id,account_id,caption,type,published_at) VALUES(?,?,?,?,?) ON CONFLICT(account_id,id) DO UPDATE SET caption=excluded.caption,type=excluded.type,published_at=excluded.published_at', input.id, input.accountId, input.caption, input.type, input.publishedAt);
  await bindNext(c.env, input.accountId); return c.json({ ok: true });
});
demo.post('/api/demo/failure', async c => {
  const input = z.object({ accountId: z.string(), mode: z.enum(['uncertain', 'rate_limit', 'permanent', 'none']) }).parse(await c.req.json());
  await demoAccount(c.env, input.accountId);
  if (input.mode === 'none') await run(c.env, 'DELETE FROM settings WHERE key=?', `failure:${input.accountId}`);
  else await run(c.env, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', `failure:${input.accountId}`, input.mode === 'rate_limit' ? 'reject_once' : input.mode);
  return c.json({ ok: true });
});
demo.post('/api/demo/send-barrier', async c => {
  const input = z.object({ accountId: z.string(), nodeId: z.string(), mode: z.enum(['arm', 'release']) }).parse(await c.req.json());
  await demoAccount(c.env, input.accountId);
  await run(c.env, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', `send-barrier:${input.accountId}:${input.nodeId}`, input.mode === 'arm' ? 'armed' : 'released');
  return c.json({ ok: true });
});
demo.get('/api/demo/send-barrier', async c => {
  const input = z.object({ accountId: z.string(), nodeId: z.string() }).parse(c.req.query());
  await demoAccount(c.env, input.accountId);
  const barrier = await one<{ value: string }>(c.env, 'SELECT value FROM settings WHERE key=?', `send-barrier:${input.accountId}:${input.nodeId}`);
  return c.json({ state: barrier?.value ?? 'idle' });
});
demo.post('/api/demo/pacing', async c => {
  const input = z.object({ accountId: z.string(), milliseconds: z.number().int().min(0).max(5000) }).parse(await c.req.json());
  await demoAccount(c.env, input.accountId);
  await run(c.env, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', `pacing:${input.accountId}`, String(input.milliseconds));
  if (input.milliseconds === 0) await run(c.env, 'UPDATE accounts SET next_send_at=0 WHERE id=?', input.accountId);
  return c.json({ ok: true });
});

demo.post('/api/demo/job-failure', async c => {
  const input = z.object({ accountId: z.string(), enabled: z.boolean() }).parse(await c.req.json());
  await demoAccount(c.env, input.accountId);
  if (input.enabled) await run(c.env, "INSERT INTO settings(key,value) VALUES(?,'true') ON CONFLICT(key) DO UPDATE SET value=excluded.value", `job-failure:${input.accountId}`);
  else await run(c.env, 'DELETE FROM settings WHERE key=?', `job-failure:${input.accountId}`);
  return c.json({ ok: true });
});
