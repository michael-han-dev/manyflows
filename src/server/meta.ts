import { Hono } from 'hono';
import { z } from 'zod';
import { decrypt, encrypt, sign, verify } from './auth';
import { ApiError, baseUrl, demoAllowed, graphVersion, now, one, rows, run, statement, strings, uid, type AccountRow, type AppEnv, type CampaignRow, type Env } from './core';

const tokenSchema = z.object({ access_token: z.string(), expires_in: z.number().optional(), user_id: z.union([z.string(), z.number()]).optional() });
const profileSchema = z.object({ id: z.string(), user_id: z.union([z.string(), z.number()]).optional(), username: z.string(), name: z.string().optional(), profile_picture_url: z.string().optional() });
const mediaSchema = z.object({ data: z.array(z.object({ id: z.string(), caption: z.string().optional(), media_type: z.enum(['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM']), media_product_type: z.string().optional(), permalink: z.string().optional(), thumbnail_url: z.string().optional(), timestamp: z.string(), like_count: z.number().optional(), comments_count: z.number().optional() })), paging: z.object({ cursors: z.object({ after: z.string().optional() }).optional(), next: z.string().optional() }).optional() });
const insightsSchema = z.object({ data: z.array(z.object({ name: z.string(), values: z.array(z.object({ value: z.number() })).optional(), total_value: z.object({ value: z.number() }).optional() })) });
const graphError = z.object({ error: z.object({ code: z.number().optional(), message: z.string().optional(), is_transient: z.boolean().optional() }) });
export type SendResult = { kind: 'accepted'; id: string } | { kind: 'rejected'; retry: boolean; error: string } | { kind: 'uncertain'; error: string };
export async function graph(env: Env, account: AccountRow, path: string, params: Record<string, string> = {}, method = 'GET') {
  if (!account.token || account.mode !== 'live') throw new ApiError(409, 'This account needs a live Instagram connection.');
  const url = new URL(`https://graph.instagram.com/${graphVersion(env)}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${await decrypt(env, account.token)}` }, signal: AbortSignal.timeout(15000) });
  const body: unknown = await response.json();
  if (!response.ok) { const error = graphError.safeParse(body); if (error.success && error.data.error.code === 190) await run(env, "UPDATE accounts SET status='reconnect' WHERE id=?", account.id); throw new ApiError(503, error.success ? `Instagram rejected the request (${error.data.error.code ?? response.status}).` : `Instagram returned HTTP ${response.status}.`); }
  return body;
}
export async function send(env: Env, account: AccountRow, action: { id: string; kind: string; commentId: string; payload: unknown }): Promise<SendResult> {
  if (account.mode === 'demo') {
    if (!demoAllowed(env)) return { kind: 'rejected', retry: false, error: 'Demo sends are disabled outside localhost.' };
    const failure = await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key=?', `failure:${account.id}`);
    if (failure) await run(env, 'DELETE FROM settings WHERE key=?', `failure:${account.id}`);
    const kind = failure?.value ?? 'accepted';
    await run(env, 'INSERT INTO demo_requests(id,account_id,action_id,request,outcome,created_at) VALUES(?,?,?,?,?,?)', uid(), account.id, action.id, JSON.stringify(action.payload), kind, await now(env));
    if (kind === 'uncertain') return { kind: 'uncertain', error: 'Simulated connection loss after send.' };
    if (kind === 'reject_once') return { kind: 'rejected', retry: true, error: 'Simulated rate limit rejection.' };
    if (kind === 'permanent') return { kind: 'rejected', retry: false, error: 'Simulated permission rejection.' };
    return { kind: 'accepted', id: `demo-${uid()}` };
  }
  if (!account.token || account.status !== 'connected') return { kind: 'rejected', retry: false, error: 'Reconnect the Instagram account before sending.' };
  const path = action.kind === 'public' ? `${action.commentId}/replies` : `${account.id}/messages`;
  try {
    const response = await fetch(`https://graph.instagram.com/${graphVersion(env)}/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${await decrypt(env, account.token)}`, 'Content-Type': 'application/json' }, body: JSON.stringify(action.payload), signal: AbortSignal.timeout(15000) });
    const body: unknown = await response.json();
    if (response.ok) { const accepted = z.object({ id: z.string().optional(), message_id: z.string().optional() }).parse(body); if (!accepted.id && !accepted.message_id) return { kind: 'uncertain', error: 'Instagram accepted the request without a message identifier.' }; return { kind: 'accepted', id: accepted.message_id ?? accepted.id ?? '' }; }
    const error = graphError.safeParse(body);
    if (response.status >= 500) return { kind: 'uncertain', error: `Instagram returned HTTP ${response.status}; delivery is unknown.` };
    const code = error.success ? error.data.error.code : undefined;
    if (code === 190) await run(env, "UPDATE accounts SET status='reconnect' WHERE id=?", account.id);
    return { kind: 'rejected', retry: response.status === 429 || [4, 17, 32, 613].includes(code ?? -1), error: `Instagram rejected the send (${code ?? response.status}).` };
  } catch { return { kind: 'uncertain', error: 'The send response was lost. Check Instagram before any manual resend.' }; }
}
export async function bindNext(env: Env, accountId: string) {
  const pending = await rows<CampaignRow>(env, "SELECT * FROM campaigns WHERE account_id=? AND status='live' AND live_target_kind='next' AND armed_at IS NOT NULL AND bound_media_id IS NULL", accountId);
  for (const campaign of pending) {
    const baseline = new Set(strings.parse(JSON.parse(campaign.baseline)));
    const publications = await rows<{ id: string }>(env, 'SELECT id FROM media WHERE account_id=? AND published_at>? ORDER BY published_at,id', accountId, campaign.armed_at);
    const first = publications.find(item => !baseline.has(item.id));
    if (first) await run(env, 'UPDATE campaigns SET bound_media_id=? WHERE id=? AND bound_media_id IS NULL', first.id, campaign.id);
  }
}
export async function syncAccount(env: Env, account: AccountRow) {
  const time = await now(env);
  if (account.mode === 'demo') { await bindNext(env, account.id); await run(env, 'UPDATE accounts SET last_sync_at=? WHERE id=?', time, account.id); return; }
  try {
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const response = mediaSchema.parse(await graph(env, account, `${account.id}/media`, { fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp,like_count,comments_count', limit: '100', ...(after ? { after } : {}) }));
      await env.DB.batch(response.data.map(media => statement(env, 'INSERT INTO media(id,account_id,caption,type,permalink,thumbnail_url,published_at,likes,comments) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,id) DO UPDATE SET caption=excluded.caption,type=excluded.type,permalink=excluded.permalink,thumbnail_url=excluded.thumbnail_url,likes=excluded.likes,comments=excluded.comments', media.id, account.id, media.caption ?? '', media.media_product_type === 'REELS' ? 'REELS' : media.media_type, media.permalink ?? null, media.thumbnail_url ?? null, Date.parse(media.timestamp), media.like_count ?? null, media.comments_count ?? null)));
      after = response.paging?.next ? response.paging.cursors?.after : undefined;
      if (!after) break;
    }
    if (env.META_INSIGHTS_ENABLED === 'true' && (!account.last_insights_at || account.last_insights_at < time - 3600000)) {
      await run(env, 'UPDATE accounts SET last_insights_at=?,sync_error=NULL WHERE id=?', time, account.id);
      const recent = await rows<{ id: string }>(env, 'SELECT id FROM media WHERE account_id=? ORDER BY published_at DESC LIMIT 25', account.id);
      for (const media of recent) {
        try {
          const result = insightsSchema.parse(await graph(env, account, `${media.id}/insights`, { metric: 'reach,likes,comments,shares,saved' }));
          const values = new Map(result.data.map(metric => [metric.name, metric.total_value?.value ?? metric.values?.[0]?.value ?? null]));
          await env.DB.batch([statement(env, 'UPDATE media SET reach=?,likes=COALESCE(?,likes),comments=COALESCE(?,comments),shares=?,saves=? WHERE account_id=? AND id=?', values.get('reach') ?? null, values.get('likes') ?? null, values.get('comments') ?? null, values.get('shares') ?? null, values.get('saved') ?? null, account.id, media.id), statement(env, 'INSERT INTO metric_snapshots(id,account_id,media_id,metrics,collected_at) VALUES(?,?,?,?,?)', uid(), account.id, media.id, JSON.stringify(Object.fromEntries(values)), time)]);
        } catch { await run(env, 'UPDATE accounts SET sync_error=? WHERE id=?', 'Insights unavailable. Check granted permissions and supported media metrics.', account.id); if (await one(env, "SELECT id FROM accounts WHERE id=? AND status='reconnect'", account.id)) break; }
      }
    }
    await bindNext(env, account.id);
    await run(env, "UPDATE accounts SET last_sync_at=? WHERE id=?", time, account.id);
  } catch (error) { await run(env, 'UPDATE accounts SET sync_error=? WHERE id=?', error instanceof ApiError ? error.message : 'Media sync failed. Try again.', account.id); throw error; }
}
export async function refreshTokens(env: Env) {
  const time = await now(env);
  for (const account of await rows<AccountRow>(env, "SELECT * FROM accounts WHERE mode='live' AND status='connected' AND token_expires_at<?", time + 14 * 86400000)) {
    if (!account.token) continue;
    try {
      const url = new URL('https://graph.instagram.com/refresh_access_token'); url.searchParams.set('grant_type', 'ig_refresh_token'); url.searchParams.set('access_token', await decrypt(env, account.token));
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error('Refresh rejected');
      const result = tokenSchema.parse(await response.json());
      await run(env, 'UPDATE accounts SET token=?,token_expires_at=? WHERE id=?', await encrypt(env, result.access_token), time + (result.expires_in ?? 5184000) * 1000, account.id);
    } catch { await run(env, "UPDATE accounts SET status='reconnect',sync_error='Token refresh failed. Reconnect this account.' WHERE id=?", account.id); }
  }
}
export const connections = new Hono<AppEnv>();
connections.get('/api/accounts/connect', async c => {
  if (!c.env.META_APP_ID || !c.env.META_APP_SECRET || !c.env.TOKEN_ENCRYPTION_KEY) throw new ApiError(503, 'Configure Meta credentials and TOKEN_ENCRYPTION_KEY before connecting.');
  const nonce = uid(); await run(c.env, 'INSERT INTO oauth_states(nonce,session_id,expires_at) VALUES(?,?,?)', nonce, c.get('sessionId'), Date.now() + 600000);
  const url = new URL('https://www.instagram.com/oauth/authorize');
  const scopes = ['instagram_business_basic', 'instagram_business_manage_comments', 'instagram_business_manage_messages', ...(c.env.META_INSIGHTS_ENABLED === 'true' ? ['instagram_business_manage_insights'] : [])];
  for (const [key, value] of Object.entries({ client_id: c.env.META_APP_ID, redirect_uri: `${baseUrl(c.env)}/auth/instagram/callback`, response_type: 'code', scope: scopes.join(','), state: await sign(c.env, { nonce, sid: c.get('sessionId') }, 600), enable_fb_login: '0', force_authentication: '1' })) url.searchParams.set(key, value);
  return c.redirect(url.href);
});
connections.get('/auth/instagram/callback', async c => {
  const state = await verify(c.env, c.req.query('state') ?? '').catch(() => { throw new ApiError(400, 'Invalid or expired connection state.'); });
  if (typeof state.nonce !== 'string' || state.sid !== c.get('sessionId')) throw new ApiError(403, 'Connection state does not match this session.');
  const consumed = await statement(c.env, 'DELETE FROM oauth_states WHERE nonce=? AND session_id=? AND expires_at>? RETURNING nonce', state.nonce, c.get('sessionId'), Date.now()).first();
  if (!consumed) throw new ApiError(400, 'Connection state has expired or was already used.');
  const code = c.req.query('code'); if (!code) throw new ApiError(400, 'Instagram authorization was cancelled.');
  if (!c.env.META_APP_ID || !c.env.META_APP_SECRET) throw new ApiError(503, 'Meta credentials are missing.');
  const form = new FormData();
  for (const [key, value] of Object.entries({ client_id: c.env.META_APP_ID, client_secret: c.env.META_APP_SECRET, grant_type: 'authorization_code', redirect_uri: `${baseUrl(c.env)}/auth/instagram/callback`, code })) form.set(key, value);
  const response = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form });
  if (!response.ok) throw new ApiError(400, 'Instagram could not exchange the authorization code.');
  const short = tokenSchema.parse(await response.json());
  const exchange = new URL('https://graph.instagram.com/access_token');
  for (const [key, value] of Object.entries({ grant_type: 'ig_exchange_token', client_secret: c.env.META_APP_SECRET, access_token: short.access_token })) exchange.searchParams.set(key, value);
  const longResponse = await fetch(exchange); if (!longResponse.ok) throw new ApiError(400, 'Instagram could not issue a long-lived token.');
  const long = tokenSchema.parse(await longResponse.json());
  const profileResponse = await fetch(`https://graph.instagram.com/${graphVersion(c.env)}/me?fields=id,user_id,username,name,profile_picture_url`, { headers: { Authorization: `Bearer ${long.access_token}` } });
  if (!profileResponse.ok) throw new ApiError(400, 'Instagram profile lookup failed.');
  const profile = profileSchema.parse(await profileResponse.json());
  const id = String(profile.user_id ?? profile.id);
  await run(c.env, "INSERT INTO accounts(id,username,name,mode,token,token_expires_at,avatar_url) VALUES(?,?,?,'live',?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,name=excluded.name,token=excluded.token,token_expires_at=excluded.token_expires_at,status='connected'", id, profile.username, profile.name ?? profile.username, await encrypt(c.env, long.access_token), Date.now() + (long.expires_in ?? 5184000) * 1000, profile.profile_picture_url ?? null);
  const account = await one<AccountRow>(c.env, 'SELECT * FROM accounts WHERE id=?', id);
  if (account) { await graph(c.env, account, `${id}/subscribed_apps`, { subscribed_fields: 'comments,messages,messaging_postbacks' }, 'POST'); await syncAccount(c.env, account); }
  return c.redirect(`${baseUrl(c.env)}/?connected=1`);
});
