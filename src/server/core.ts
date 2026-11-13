import { z } from 'zod';
import { campaignInputSchema, buttonSchema, type Campaign, type Contact, type FlowRun, type Action, type Account, type Media } from '../shared/domain';

export interface Env {
  DB: D1Database; OUTBOX: Queue<{ id: string }>; ASSETS: Fetcher;
  ADMIN_PASSWORD?: string; SESSION_SECRET?: string; TOKEN_ENCRYPTION_KEY?: string;
  DEMO_MODE?: string; PUBLIC_BASE_URL?: string; GRAPH_VERSION?: string;
  META_APP_ID?: string; META_APP_SECRET?: string; META_WEBHOOK_VERIFY_TOKEN?: string; META_INSIGHTS_ENABLED?: string;
}
export type AppEnv = { Bindings: Env; Variables: { sessionId: string } };
export const uid = () => crypto.randomUUID();
export const localHost = (url: string) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
export const demoAllowed = (env: Env, url = env.PUBLIC_BASE_URL ?? '') => env.DEMO_MODE === 'true' && !!url && localHost(url) && (!env.PUBLIC_BASE_URL || localHost(env.PUBLIC_BASE_URL));
export const baseUrl = (env: Env) => {
  const url = new URL(env.PUBLIC_BASE_URL ?? 'http://localhost:8787');
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !localHost(url.href))) throw new Error('PUBLIC_BASE_URL must be an HTTPS origin (HTTP localhost is supported).');
  return url.origin;
};
export const graphVersion = (env: Env) => /^v\d+\.0$/.test(env.GRAPH_VERSION ?? '') ? env.GRAPH_VERSION! : 'v27.0';
export const statement = (env: Env, sql: string, ...args: (string | number | null)[]) => env.DB.prepare(sql).bind(...args);
export const one = <T>(env: Env, sql: string, ...args: (string | number | null)[]) => statement(env, sql, ...args).first<T>();
export async function rows<T>(env: Env, sql: string, ...args: (string | number | null)[]) { return (await statement(env, sql, ...args).all<T>()).results; }
export const run = (env: Env, sql: string, ...args: (string | number | null)[]) => statement(env, sql, ...args).run();
export async function now(env: Env) {
  if (demoAllowed(env)) { const setting = await one<{ value: string }>(env, "SELECT value FROM settings WHERE key='clock'"); if (setting) return Number(setting.value); }
  return Date.now();
}
export const jsonObject = z.record(z.string(), z.string());
export const strings = z.array(z.string());
export const buttons = z.array(buttonSchema);
export interface CampaignRow { id: string; account_id: string; name: string; status: Campaign['status']; draft: string; live_version_id: string | null; bound_media_id: string | null; armed_at: number | null; baseline: string; created_at: number; updated_at: number; }
export const campaign = (r: CampaignRow): Campaign => ({ id: r.id, accountId: r.account_id, name: r.name, status: r.status, draft: campaignInputSchema.parse(JSON.parse(r.draft)), liveVersionId: r.live_version_id, boundMediaId: r.bound_media_id, armedAt: r.armed_at, createdAt: r.created_at, updatedAt: r.updated_at });
export interface ContactRow { id: string; account_id: string; instagram_id: string; username: string; fields: string; tags: string; last_interaction_at: number | null; created_at: number; }
export const contact = (r: ContactRow): Contact => ({ id: r.id, accountId: r.account_id, instagramId: r.instagram_id, username: r.username, fields: jsonObject.parse(JSON.parse(r.fields)), tags: strings.parse(JSON.parse(r.tags)), lastInteractionAt: r.last_interaction_at, createdAt: r.created_at });
export interface RunRow { id: string; account_id: string; contact_id: string; campaign_id: string; version_id: string; comment_id: string; media_id: string; node_id: string | null; state: FlowRun['state']; wake_at: number | null; comment_at: number; private_sent: number; lock_until: number; created_at: number; updated_at: number; }
export const flowRun = (r: RunRow): FlowRun => ({ id: r.id, accountId: r.account_id, contactId: r.contact_id, campaignId: r.campaign_id, versionId: r.version_id, commentId: r.comment_id, mediaId: r.media_id, nodeId: r.node_id, state: r.state, wakeAt: r.wake_at, createdAt: r.created_at, updatedAt: r.updated_at });
export interface ActionRow { id: string; account_id: string; run_id: string; node_id: string; kind: Action['kind']; status: Action['status']; text: string; buttons: string; payload: string | null; attempts: number; error: string | null; available_at: number; created_at: number; updated_at: number; }
export const action = (r: ActionRow): Action => ({ id: r.id, accountId: r.account_id, runId: r.run_id, nodeId: r.node_id, kind: r.kind, status: r.status, text: r.text, attempts: r.attempts, error: r.error, createdAt: r.created_at, updatedAt: r.updated_at });
export interface AccountRow { id: string; username: string; name: string; mode: Account['mode']; status: Account['status']; avatar_url: string | null; token: string | null; token_expires_at: number | null; last_sync_at: number | null; permissions: string; sync_error: string | null; }
export const account = (r: AccountRow): Account => ({ id: r.id, username: r.username, name: r.name, mode: r.mode, status: r.status, avatarUrl: r.avatar_url, tokenExpiresAt: r.token_expires_at, lastSyncAt: r.last_sync_at });
export interface MediaRow { id: string; account_id: string; caption: string; type: Media['type']; permalink: string | null; thumbnail_url: string | null; published_at: number; reach: number | null; likes: number | null; comments: number | null; shares: number | null; saves: number | null; }
export const media = (r: MediaRow): Media => ({ id: r.id, accountId: r.account_id, caption: r.caption, type: r.type, permalink: r.permalink, thumbnailUrl: r.thumbnail_url, publishedAt: r.published_at, reach: r.reach, likes: r.likes, comments: r.comments, shares: r.shares, saves: r.saves });
export class ApiError extends Error { constructor(public status: 400 | 401 | 403 | 404 | 409 | 429 | 503, message: string, public details?: string[]) { super(message); } }
export const requireValue = <T>(value: T | null | undefined, message = 'Not found'): T => { if (value == null) throw new ApiError(404, message); return value; };
