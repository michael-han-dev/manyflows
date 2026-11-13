import { Hono } from 'hono';
import { ZodError } from 'zod';
import { auth, requireOwner } from './auth';
import { api } from './api';
import { demo } from './demo';
import { ApiError, demoAllowed, now, one, rows, run, uid, type AccountRow, type AppEnv, type Env, type QueueJob } from './core';
import { dispatch, ingestSigned } from './events';
import { drain, processJob, resumeRun } from './engine';
import { connections, refreshTokens, syncAccount } from './meta';

const app = new Hono<AppEnv>();
app.onError((error, c) => {
  if (error instanceof ApiError) return c.json({ error: error.message, ...(error.details ? { details: error.details } : {}) }, error.status);
  if (error instanceof ZodError) return c.json({ error: 'Invalid request.', details: error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`) }, 400);
  if (error instanceof SyntaxError) return c.json({ error: 'Invalid JSON.' }, 400);
  return c.json({ error: 'The request could not be completed. Check the configuration and try again.' }, 500);
});
app.use('*', async (c, next) => { if (c.env.DEMO_MODE === 'true' && !demoAllowed(c.env, c.req.url)) throw new ApiError(503, 'Demo mode is restricted to localhost.'); c.header('X-Content-Type-Options', 'nosniff'); c.header('Referrer-Policy', 'same-origin'); await next(); });
app.get('/webhooks/instagram', c => {
  if (!c.env.META_WEBHOOK_VERIFY_TOKEN || c.req.query('hub.mode') !== 'subscribe' || c.req.query('hub.verify_token') !== c.env.META_WEBHOOK_VERIFY_TOKEN) return c.text('Invalid verification token.', 403);
  return c.text(c.req.query('hub.challenge') ?? '');
});
app.post('/webhooks/instagram', async c => {
  const body = await c.req.arrayBuffer();
  if (body.byteLength > 1000000) throw new ApiError(400, 'Webhook body is too large.');
  await ingestSigned(c.env, body, c.req.header('x-hub-signature-256') ?? '');
  c.executionCtx.waitUntil(dispatch(c.env));
  return c.json({ ok: true });
});
app.get('/r/:token', async c => {
  const link = await one<{ token: string; account_id: string; campaign_id: string; run_id: string; contact_id: string; destination: string }>(c.env, 'SELECT * FROM links WHERE token=?', c.req.param('token'));
  if (!link || !/^https?:\/\//.test(link.destination)) return c.text('Link not found.', 404);
  const userAgent = c.req.header('User-Agent') ?? '';
  const automated = /bot|crawler|spider|preview|facebookexternalhit|meta-externalagent|whatsapp|slack|discord|telegram/i.test(userAgent) || c.req.header('Purpose') === 'prefetch' || c.req.header('Sec-Purpose')?.includes('prefetch') || c.req.method === 'HEAD';
  await run(c.env, 'INSERT INTO clicks(id,account_id,campaign_id,run_id,contact_id,link_id,automated,created_at) VALUES(?,?,?,?,?,?,?,?)', uid(), link.account_id, link.campaign_id, link.run_id, link.contact_id, link.token, automated ? 1 : 0, await now(c.env));
  c.header('Cache-Control', 'no-store, private, max-age=0'); c.header('Pragma', 'no-cache'); c.header('Referrer-Policy', 'no-referrer');
  return c.redirect(link.destination, 302);
});
app.route('/', auth);
app.use('/api/*', requireOwner);
app.use('/auth/*', requireOwner);
app.route('/', api);
app.route('/', connections);
app.route('/', demo);
app.all('/api/*', c => c.json({ error: 'Endpoint not found.' }, 404));
app.get('*', c => c.env.ASSETS.fetch(c.req.raw));
export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<QueueJob>, env: Env) { for (const message of batch.messages) { try { if (message.body.kind === 'run') await resumeRun(env, message.body.id); else await processJob(env, message.body.id); message.ack(); } catch { message.retry({ delaySeconds: 60 }); } } },
  async scheduled(_event: ScheduledController, env: Env, context: ExecutionContext) {
    context.waitUntil((async () => {
      if (env.DEMO_MODE === 'true' && !demoAllowed(env)) return;
      await drain(env); await dispatch(env); await refreshTokens(env);
      const time = await now(env);
      for (const account of await rows<AccountRow>(env, "SELECT * FROM accounts WHERE mode='live' AND status='connected' AND (last_sync_at IS NULL OR last_sync_at<? OR EXISTS(SELECT 1 FROM campaigns WHERE campaigns.account_id=accounts.id AND campaigns.status='live' AND campaigns.live_target_kind='next' AND campaigns.bound_media_id IS NULL))", time - 15 * 60000)) { try { await syncAccount(env, account); } catch { continue; } }
      await run(env, 'DELETE FROM sessions WHERE expires_at<?', Date.now());
      await run(env, 'DELETE FROM oauth_states WHERE expires_at<?', Date.now());
    })());
  },
};
