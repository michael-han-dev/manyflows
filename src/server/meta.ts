import { Hono } from 'hono';
import { z } from 'zod';
import { metaFetch } from '@manyflows/meta-fetch';
import { decrypt, encrypt, sign, verify } from './auth';
import { accountSelect, ApiError, baseUrl, demoAllowed, graphVersion, metaConfigured, now, one, rows, run, statement, strings, uid, type AccountRow, type AppEnv, type CampaignRow, type Env } from './core';

const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.-]+$/);
const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().int().nonnegative().optional() });
const businessSchema = z.object({ client_business_id: identifier });
const cursorSchema = z.string().min(1).max(4096).regex(/^[^\s\x00-\x1f\x7f]+$/);
const assignedSchema = z.object({ data: z.array(z.object({ id: identifier, username: z.string().min(1).max(200) })), paging: z.object({ cursors: z.object({ after: cursorSchema.optional() }).optional(), next: z.string().optional() }).optional() });
const mediaSchema = z.object({ data: z.array(z.object({ id: z.string(), caption: z.string().optional(), media_type: z.enum(['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM']), media_product_type: z.string().optional(), permalink: z.string().optional(), thumbnail_url: z.string().optional(), timestamp: z.string(), like_count: z.number().optional(), comments_count: z.number().optional() })), paging: z.object({ cursors: z.object({ after: cursorSchema.optional() }).optional(), next: z.string().optional() }).optional() });
const insightsSchema = z.object({ data: z.array(z.object({ name: z.string(), values: z.array(z.object({ value: z.number() })).optional(), total_value: z.object({ value: z.number() }).optional() })) });
const graphError = z.object({ error: z.object({ code: z.number().optional() }) });
type Credential = { id: string; generation: string; token: string };
export type SendResult = { kind: 'accepted'; id: string } | { kind: 'rejected'; retry: boolean; error: string } | { kind: 'uncertain'; error: string };

const membership = `EXISTS(SELECT 1 FROM accounts member JOIN meta_grants credential ON credential.id=member.grant_id
  WHERE member.id=? AND member.mode='live' AND member.grant_id=? AND credential.generation=?
  AND credential.invalidated_at IS NULL AND (credential.expires_at IS NULL OR credential.expires_at>?) )`;
const memberArgs = (account: AccountRow): (string | number | null)[] => [account.id, account.grant_id, account.grant_generation, Date.now()];
async function credential(env: Env, account: AccountRow, sending = false): Promise<Credential> {
  if (account.mode !== 'live' || !account.grant_id || !account.grant_generation) throw new ApiError(409, 'Reconnect the Instagram account before continuing.');
  const stored = await one<Credential>(env, `SELECT g.id,g.generation,g.token FROM meta_grants g JOIN accounts a ON a.grant_id=g.id
    WHERE a.id=? AND a.mode='live' AND a.grant_id=? AND g.generation=? AND g.meta_app_id=? AND g.config_id=?
    AND g.invalidated_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?) AND a.status ${sending ? "='connected'" : "IN ('connected','restricted')"}`,
    account.id, account.grant_id, account.grant_generation, env.META_APP_ID ?? '', env.META_LOGIN_CONFIG_ID ?? '', Date.now());
  if (!stored) throw new ApiError(409, 'Reconnect the Instagram account before continuing.');
  let token: string;
  try { token = await decrypt(env, stored.token); }
  catch { throw new ApiError(409, 'Reconnect the Instagram account before continuing.'); }
  const current = await one(env, `${accountSelect} WHERE id=? AND grant_id=? AND grant_generation=? AND status ${sending ? "='connected'" : "IN ('connected','restricted')"}`, account.id, stored.id, stored.generation);
  if (!current) throw new ApiError(409, 'Reconnect the Instagram account before continuing.');
  return { id: stored.id, generation: stored.generation, token };
}
async function invalidate(env: Env, account: AccountRow, grant: Credential) {
  await run(env, 'UPDATE meta_grants SET invalidated_at=? WHERE id=? AND generation=? AND EXISTS(SELECT 1 FROM accounts WHERE id=? AND grant_id=?)', Date.now(), grant.id, grant.generation, account.id, grant.id);
}
function graphUrl(env: Env, path: string, params: Record<string, string> = {}) {
  const url = new URL(`https://graph.facebook.com/${graphVersion(env)}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}
async function tokenRequest(env: Env, token: string, path: string, params: Record<string, string> = {}, method = 'GET') {
  const response = await metaFetch(graphUrl(env, path, params), { method, headers: { Authorization: `Bearer ${token}` }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new ApiError(503, 'Meta could not complete the connection. Try connecting again.');
  const body: unknown = await response.json();
  return body;
}
export async function graph(env: Env, account: AccountRow, path: string, params: Record<string, string> = {}, method = 'GET') {
  const grant = await credential(env, account);
  try {
    const response = await metaFetch(graphUrl(env, path, params), { method, headers: { Authorization: `Bearer ${grant.token}` }, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (response.status >= 300 && response.status < 400) throw new ApiError(503, 'Instagram redirected the request. Check the connection and try again.');
    const body: unknown = await response.json();
    if (!response.ok) {
      const error = graphError.safeParse(body);
      if (error.success && error.data.error.code === 190) await invalidate(env, account, grant);
      throw new ApiError(503, 'Instagram could not complete the request. Check the connection and try again.');
    }
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Instagram could not be reached. Try again.');
  }
}
export async function followsAccount(env: Env, account: AccountRow, instagramId: string): Promise<boolean> {
  if (account.mode === 'demo') {
    if (!demoAllowed(env)) throw new ApiError(503, 'Demo follow checks are disabled outside localhost.');
    const status = await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key=?', `following:${account.id}:${instagramId}`);
    if (status?.value === 'unavailable') throw new ApiError(503, 'Simulated follow check unavailable.');
    return status?.value === 'true';
  }
  const result = z.object({ is_user_follow_business: z.boolean() }).safeParse(await graph(env, account, instagramId, { fields: 'is_user_follow_business' }));
  if (!result.success) throw new ApiError(503, 'Instagram did not return a valid follow status. Try again.');
  return result.data.is_user_follow_business;
}

export async function send(env: Env, account: AccountRow, action: { id: string; nodeId: string; kind: string; commentId: string; payload: unknown }): Promise<SendResult> {
  if (account.mode === 'demo') {
    if (!demoAllowed(env)) return { kind: 'rejected', retry: false, error: 'Demo sends are disabled outside localhost.' };
    const failure = await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key=?', `failure:${account.id}`);
    if (failure) await run(env, 'DELETE FROM settings WHERE key=?', `failure:${account.id}`);
    const kind = failure?.value ?? 'accepted';
    await run(env, 'INSERT INTO demo_requests(id,account_id,action_id,request,outcome,created_at) VALUES(?,?,?,?,?,?)', uid(), account.id, action.id, JSON.stringify(action.payload), kind, await now(env));
    const barrierKey = `send-barrier:${account.id}:${action.nodeId}`;
    const blocked = await statement(env, "UPDATE settings SET value='blocked' WHERE key=? AND value='armed' RETURNING key", barrierKey).first();
    if (blocked) {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && (await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key=?', barrierKey))?.value === 'blocked') await new Promise(resolve => setTimeout(resolve, 100));
      await run(env, "UPDATE settings SET value='released' WHERE key=? AND value='blocked'", barrierKey);
    }
    if (kind === 'uncertain') return { kind: 'uncertain', error: 'Simulated connection loss after send.' };
    if (kind === 'reject_once') return { kind: 'rejected', retry: true, error: 'Simulated rate limit rejection.' };
    if (kind === 'permanent') return { kind: 'rejected', retry: false, error: 'Simulated permission rejection.' };
    return { kind: 'accepted', id: `demo-${uid()}` };
  }
  let grant: Credential;
  try { grant = await credential(env, account, true); }
  catch { return { kind: 'rejected', retry: false, error: 'Reconnect the Instagram account before sending.' }; }
  const path = action.kind === 'public' ? `${action.commentId}/replies` : `${account.id}/messages`;
  try {
    const response = await metaFetch(graphUrl(env, path), { method: 'POST', headers: { Authorization: `Bearer ${grant.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(action.payload), redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (response.status >= 300 && response.status < 400) return { kind: 'rejected', retry: false, error: 'Instagram redirected the send. Check the connection before retrying.' };
    const body: unknown = await response.json();
    if (response.ok) {
      const accepted = z.object({ id: z.string().optional(), message_id: z.string().optional() }).safeParse(body);
      if (!accepted.success || (!accepted.data.id && !accepted.data.message_id)) return { kind: 'uncertain', error: 'Instagram accepted the request without a message identifier.' };
      return { kind: 'accepted', id: accepted.data.message_id ?? accepted.data.id ?? '' };
    }
    const error = graphError.safeParse(body);
    if (response.status >= 500) return { kind: 'uncertain', error: 'Instagram returned an unexpected response; delivery is unknown.' };
    const code = error.success ? error.data.error.code : undefined;
    if (code === 190) await invalidate(env, account, grant);
    return { kind: 'rejected', retry: response.status === 429 || [4, 17, 32, 613].includes(code ?? -1), error: 'Instagram rejected the send. Check the connection and permissions.' };
  } catch { return { kind: 'uncertain', error: 'The send response was lost. Check Instagram before any manual resend.' }; }
}
export async function bindNext(env: Env, accountId: string, expected?: AccountRow) {
  const pending = await rows<CampaignRow>(env, "SELECT * FROM campaigns WHERE account_id=? AND status='live' AND live_target_kind='next' AND armed_at IS NOT NULL AND bound_media_id IS NULL", accountId);
  for (const campaign of pending) {
    const baseline = new Set(strings.parse(JSON.parse(campaign.baseline)));
    const publications = await rows<{ id: string }>(env, 'SELECT id FROM media WHERE account_id=? AND published_at>=? ORDER BY published_at,id', accountId, Math.floor((campaign.armed_at ?? 0) / 1000) * 1000);
    const first = publications.find(item => !baseline.has(item.id));
    if (first) await run(env, `UPDATE campaigns SET bound_media_id=? WHERE id=? AND bound_media_id IS NULL${expected ? ` AND ${membership}` : ''}`, first.id, campaign.id, ...(expected ? memberArgs(expected) : []));
  }
}
export async function syncAccount(env: Env, account: AccountRow) {
  const time = await now(env);
  if (account.mode === 'demo') { await bindNext(env, account.id); await run(env, 'UPDATE accounts SET last_sync_at=? WHERE id=?', time, account.id); return; }
  if (account.status !== 'connected') throw new ApiError(409, 'Reconnect the Instagram account before syncing.');
  const guarded = (sql: string, args: (string | number | null)[]) => statement(env, `${sql} AND ${membership}`, ...args, ...memberArgs(account));
  try {
    let after: string | undefined;
    for (let page = 0; page < 10; page++) {
      const response = mediaSchema.parse(await graph(env, account, `${account.id}/media`, { fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,timestamp,like_count,comments_count', limit: '100', ...(after ? { after } : {}) }));
      if (response.data.length) await env.DB.batch(response.data.map(media => statement(env, `INSERT INTO media(id,account_id,caption,type,permalink,thumbnail_url,published_at,likes,comments) SELECT ?,?,?,?,?,?,?,?,? WHERE ${membership} ON CONFLICT(account_id,id) DO UPDATE SET caption=excluded.caption,type=excluded.type,permalink=excluded.permalink,thumbnail_url=excluded.thumbnail_url,likes=excluded.likes,comments=excluded.comments`, media.id, account.id, media.caption ?? '', media.media_product_type === 'REELS' ? 'REELS' : media.media_type, media.permalink ?? null, media.thumbnail_url ?? null, Date.parse(media.timestamp), media.like_count ?? null, media.comments_count ?? null, ...memberArgs(account))));
      after = response.paging?.next ? response.paging.cursors?.after : undefined;
      if (!after) break;
    }
    await guarded('UPDATE accounts SET sync_error=NULL WHERE id=?', [account.id]).run();
    if (env.META_INSIGHTS_ENABLED === 'true' && (!account.last_insights_at || account.last_insights_at < time - 3600000)) {
      await guarded('UPDATE accounts SET last_insights_at=? WHERE id=?', [time, account.id]).run();
      const recent = await rows<{ id: string }>(env, 'SELECT id FROM media WHERE account_id=? ORDER BY published_at DESC LIMIT 25', account.id);
      for (const media of recent) {
        try {
          const result = insightsSchema.parse(await graph(env, account, `${media.id}/insights`, { metric: 'reach,likes,comments,shares,saved' }));
          const values = new Map(result.data.map(metric => [metric.name, metric.total_value?.value ?? metric.values?.[0]?.value ?? null]));
          await env.DB.batch([guarded('UPDATE media SET reach=?,likes=COALESCE(?,likes),comments=COALESCE(?,comments),shares=?,saves=? WHERE account_id=? AND id=?', [values.get('reach') ?? null, values.get('likes') ?? null, values.get('comments') ?? null, values.get('shares') ?? null, values.get('saved') ?? null, account.id, media.id]), statement(env, `INSERT INTO metric_snapshots(id,account_id,media_id,metrics,collected_at) SELECT ?,?,?,?,? WHERE ${membership}`, uid(), account.id, media.id, JSON.stringify(Object.fromEntries(values)), time, ...memberArgs(account))]);
        } catch { await guarded('UPDATE accounts SET sync_error=? WHERE id=?', ['Insights unavailable. Check granted permissions and supported media metrics.', account.id]).run(); if (!await one(env, `${accountSelect} WHERE id=? AND status='connected' AND grant_id=? AND grant_generation=?`, account.id, account.grant_id, account.grant_generation)) break; }
      }
    }
    if (await one(env, `${accountSelect} WHERE id=? AND status='connected' AND grant_id=? AND grant_generation=?`, account.id, account.grant_id, account.grant_generation)) await bindNext(env, account.id, account);
    await guarded('UPDATE accounts SET last_sync_at=? WHERE id=?', [time, account.id]).run();
  } catch (error) {
    await guarded('UPDATE accounts SET sync_error=? WHERE id=?', ['Media sync failed. Check the connection and try again.', account.id]).run();
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'Media sync failed. Try again.');
  }
}
async function assignedAccounts(env: Env, token: string) {
  const accounts = new Map<string, z.infer<typeof assignedSchema>['data'][number]>();
  const cursors = new Set<string>();
  let after: string | undefined;
  let count = 0;
  for (let page = 0; page < 100; page++) {
    const result = assignedSchema.parse(await tokenRequest(env, token, 'me/assigned_instagram_accounts', { fields: 'id,username', limit: '100', ...(after ? { after } : {}) }));
    count += result.data.length;
    if (count > 10000) throw new ApiError(400, 'Too many Instagram accounts were shared. Try again with fewer accounts.');
    for (const account of result.data) {
      const prior = accounts.get(account.id);
      if (prior && prior.username !== account.username) throw new ApiError(400, 'Meta returned conflicting account details. Try connecting again.');
      accounts.set(account.id, account);
    }
    if (!result.paging?.next) {
      if (!accounts.size) throw new ApiError(400, 'No Instagram accounts were shared. Connect again and select an account.');
      return [...accounts.values()];
    }
    const cursor = result.paging.cursors?.after;
    if (!cursor || cursors.has(cursor)) throw new ApiError(400, 'Meta returned incomplete account discovery. Try connecting again.');
    cursors.add(cursor); after = cursor;
  }
  throw new ApiError(400, 'Account discovery exceeded its limit. Try again with fewer accounts.');
}
export const connections = new Hono<AppEnv>();
connections.get('/api/accounts/connect', async c => {
  if (!metaConfigured(c.env)) throw new ApiError(503, 'Complete the Meta Unified Login configuration before connecting.');
  const app = c.env.META_APP_ID ?? '', config = c.env.META_LOGIN_CONFIG_ID ?? '', redirect = `${baseUrl(c.env)}/auth/instagram/callback`;
  const nonce = uid(); await run(c.env, 'INSERT INTO oauth_states(nonce,session_id,expires_at) VALUES(?,?,?)', nonce, c.get('sessionId'), Date.now() + 600000);
  const url = new URL('https://www.facebook.com/dialog/oauth');
  for (const [key, value] of Object.entries({ client_id: app, config_id: config, redirect_uri: redirect, response_type: 'code', state: await sign(c.env, { nonce, sid: c.get('sessionId'), app, config, redirect }, 600), prompt: 'login' })) url.searchParams.set(key, value);
  return c.redirect(url.href);
});
connections.get('/auth/instagram/callback', async c => {
  const state = await verify(c.env, c.req.query('state') ?? '').catch(() => { throw new ApiError(400, 'Invalid or expired connection state.'); });
  const redirect = `${baseUrl(c.env)}/auth/instagram/callback`;
  if (typeof state.nonce !== 'string' || state.sid !== c.get('sessionId') || state.app !== c.env.META_APP_ID || state.config !== c.env.META_LOGIN_CONFIG_ID || state.redirect !== redirect) throw new ApiError(403, 'Connection state does not match this session or configuration. Start a new connection.');
  const consumed = await statement(c.env, 'DELETE FROM oauth_states WHERE nonce=? AND session_id=? AND expires_at>? RETURNING nonce', state.nonce, c.get('sessionId'), Date.now()).first();
  if (!consumed) throw new ApiError(400, 'Connection state has expired or was already used.');
  const finish = (result: 'connected' | 'partial' | 'cancelled' | 'failed') => c.redirect(`${baseUrl(c.env)}/?connection=${result}`);
  const code = c.req.query('code');
  if (c.req.query('error') || !code) return finish('cancelled');
  if (!metaConfigured(c.env)) return finish('failed');
  try {
    const exchange = graphUrl(c.env, 'oauth/access_token', { client_id: c.env.META_APP_ID ?? '', client_secret: c.env.META_APP_SECRET ?? '', redirect_uri: redirect, code });
    const response = await metaFetch(exchange, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if (!response.ok) return finish('failed');
    const token = tokenSchema.parse(await response.json());
    const business = businessSchema.parse(await tokenRequest(c.env, token.access_token, 'me', { fields: 'client_business_id' }));
    const selected = await assignedAccounts(c.env, token.access_token);
    const selectedIds = JSON.stringify(selected.map(account => account.id));
    if (await one(c.env, `${accountSelect} WHERE mode='demo' AND id IN (SELECT value FROM json_each(?))`, selectedIds)) return finish('failed');
    const time = Date.now(), generation = uid(), grantId = uid();
    const encrypted = await encrypt(c.env, token.access_token);
    const expiresAt = token.expires_in ? time + token.expires_in * 1000 : null;
    await c.env.DB.batch([
      statement(c.env, `INSERT INTO meta_grants(id,meta_app_id,config_id,client_business_id,token,expires_at,generation,connected_at) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM (${accountSelect}) WHERE mode='demo' AND id IN (SELECT value FROM json_each(?))) ON CONFLICT(meta_app_id,config_id,client_business_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at,invalidated_at=NULL,generation=excluded.generation,connected_at=excluded.connected_at`, grantId, c.env.META_APP_ID ?? '', c.env.META_LOGIN_CONFIG_ID ?? '', business.client_business_id, encrypted, expiresAt, generation, time, selectedIds),
      statement(c.env, `UPDATE accounts SET grant_id=NULL,status='reconnect',sync_error='This account was not selected. Reconnect and share it to restore access.' WHERE mode='live' AND grant_id=(SELECT id FROM meta_grants WHERE meta_app_id=? AND config_id=? AND client_business_id=? AND generation=?) AND id NOT IN (SELECT value FROM json_each(?))`, c.env.META_APP_ID ?? '', c.env.META_LOGIN_CONFIG_ID ?? '', business.client_business_id, generation, selectedIds),
      statement(c.env, `INSERT INTO accounts(id,username,name,mode,status,grant_id) SELECT json_extract(value,'$.id'),json_extract(value,'$.username'),json_extract(value,'$.username'),'live','restricted',g.id FROM json_each(?) JOIN meta_grants g ON g.meta_app_id=? AND g.config_id=? AND g.client_business_id=? AND g.generation=? WHERE 1 ON CONFLICT(id) DO UPDATE SET username=excluded.username,name=excluded.name,grant_id=excluded.grant_id,status='restricted',sync_error=NULL WHERE accounts.mode='live'`, JSON.stringify(selected), c.env.META_APP_ID ?? '', c.env.META_LOGIN_CONFIG_ID ?? '', business.client_business_id, generation),
      statement(c.env, 'DELETE FROM meta_grants WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE accounts.grant_id=meta_grants.id)'),
    ]);
    if (!await one(c.env, 'SELECT id FROM meta_grants WHERE generation=?', generation)) return finish('failed');
    let partial = false;
    for (const selectedAccount of selected) {
      const account = await one<AccountRow>(c.env, `${accountSelect} WHERE id=? AND grant_generation=?`, selectedAccount.id, generation);
      if (!account) { partial = true; continue; }
      try {
        const subscription = z.object({ success: z.literal(true) }).parse(await graph(c.env, account, `${account.id}/subscribed_apps`, { subscribed_fields: 'comments,messages,messaging_postbacks' }, 'POST'));
        if (subscription.success) await run(c.env, `UPDATE accounts SET status='connected',sync_error=NULL WHERE id=? AND ${membership}`, account.id, ...memberArgs(account));
      } catch {
        partial = true;
        await run(c.env, `UPDATE accounts SET status='restricted',sync_error='Webhook subscription failed. Reconnect this account to try again.' WHERE id=? AND ${membership}`, account.id, ...memberArgs(account));
        continue;
      }
      const connected = await one<AccountRow>(c.env, `${accountSelect} WHERE id=? AND grant_id=? AND grant_generation=? AND status='connected'`, account.id, account.grant_id, generation);
      if (connected) { try { await syncAccount(c.env, connected); } catch { partial = true; } }
      else partial = true;
    }
    return finish(partial ? 'partial' : 'connected');
  } catch { return finish('failed'); }
});
