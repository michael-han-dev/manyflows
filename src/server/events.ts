import { z } from 'zod';
import { digest, validSignature } from './auth';
import { ApiError, now, one, rows, run, statement, type AccountRow, type Env } from './core';

const eventBase = { id: z.string(), accountId: z.string(), senderId: z.string(), username: z.string(), timestamp: z.number() };
export const eventSchema = z.discriminatedUnion('kind', [
  z.object({ ...eventBase, kind: z.literal('comment'), commentId: z.string(), mediaId: z.string(), text: z.string() }),
  z.object({ ...eventBase, kind: z.literal('response'), text: z.string(), payload: z.string().nullable() }),
]);
export type Event = z.infer<typeof eventSchema>;
const webhookSchema = z.object({ object: z.literal('instagram'), entry: z.array(z.object({ id: z.string(), time: z.number().optional(), changes: z.array(z.object({ field: z.string(), value: z.unknown() })).optional(), messaging: z.array(z.unknown()).optional() })) });
const commentSchema = z.object({ id: z.string(), from: z.object({ id: z.string(), username: z.string().optional() }), media: z.object({ id: z.string() }), text: z.string(), timestamp: z.union([z.number(), z.string()]).optional() });
const responseSchema = z.object({ sender: z.object({ id: z.string() }), recipient: z.object({ id: z.string() }), timestamp: z.number().optional(), message: z.object({ mid: z.string(), text: z.string().optional(), is_echo: z.boolean().optional(), quick_reply: z.object({ payload: z.string() }).optional() }).optional(), postback: z.object({ mid: z.string().optional(), title: z.string().optional(), payload: z.string() }).optional() });
const eventTime = (value: string | number | undefined, fallback: number) => { const number = typeof value === 'string' ? Date.parse(value) : value ?? fallback; return Number.isFinite(number) ? (number < 1e12 ? number * 1000 : number) : fallback; };
export async function ingestSigned(env: Env, body: string | ArrayBuffer, signature: string, secret = env.META_APP_SECRET) {
  if (!secret || !await validSignature(secret, body, signature)) throw new ApiError(401, 'Invalid webhook signature.');
  const payload = webhookSchema.parse(JSON.parse(typeof body === 'string' ? body : new TextDecoder().decode(body)));
  const time = await now(env);
  const events: Event[] = [];
  for (const entry of payload.entry) {
    const account = await one<AccountRow>(env, 'SELECT * FROM accounts WHERE id=?', entry.id);
    if (!account) continue;
    for (const change of entry.changes ?? []) {
      if (change.field !== 'comments') continue;
      const parsed = commentSchema.safeParse(change.value); if (!parsed.success) continue;
      const value = parsed.data; if (value.from.id === entry.id) continue;
      events.push({ kind: 'comment', id: `${entry.id}:comment:${value.id}`, accountId: entry.id, senderId: value.from.id, username: value.from.username ?? value.from.id, timestamp: Math.min(time, eventTime(value.timestamp ?? entry.time, time)), commentId: value.id, mediaId: value.media.id, text: value.text });
    }
    for (const raw of entry.messaging ?? []) {
      const parsed = responseSchema.safeParse(raw); if (!parsed.success) continue;
      const value = parsed.data; if (value.message?.is_echo || value.sender.id === entry.id || value.recipient.id !== entry.id || (!value.message && !value.postback)) continue;
      const identity = value.message?.mid ?? value.postback?.mid ?? await digest(JSON.stringify(raw));
      events.push({ kind: 'response', id: `${entry.id}:response:${identity}`, accountId: entry.id, senderId: value.sender.id, username: value.sender.id, timestamp: Math.min(time, eventTime(value.timestamp, time)), text: value.message?.text ?? value.postback?.title ?? '', payload: value.message?.quick_reply?.payload ?? value.postback?.payload ?? null });
    }
  }
  for (const event of events) await env.DB.batch([
    statement(env, 'INSERT OR IGNORE INTO events(id,account_id,payload,received_at) VALUES(?,?,?,?)', event.id, event.accountId, JSON.stringify(event), time),
    statement(env, 'INSERT OR IGNORE INTO outbox(id,event_id,available_at) VALUES(?,?,?)', event.id, event.id, time),
  ]);
  return events.map(event => event.id);
}
export async function dispatch(env: Env) {
  const time = await now(env);
  const pending = await rows<{ id: string }>(env, "SELECT id FROM outbox WHERE (state='pending' AND available_at<=?) OR (state='queued' AND lease_until<?) ORDER BY available_at LIMIT 100", time, time);
  for (const job of pending) {
    await env.OUTBOX.send({ id: job.id });
    await run(env, "UPDATE outbox SET state='queued',lease_until=? WHERE id=? AND state IN ('pending','queued')", time + 120000, job.id);
  }
}
