import { z } from 'zod';
import { buttonSchema, campaignInputSchema, targetSchema, type Bootstrap } from '../shared/domain';

const account = z.object({ id: z.string(), username: z.string(), name: z.string(), mode: z.enum(['demo', 'live']), status: z.enum(['connected', 'reconnect', 'restricted']), avatarUrl: z.string().nullable(), tokenExpiresAt: z.number().nullable(), lastSyncAt: z.number().nullable() });
const media = z.object({ id: z.string(), accountId: z.string(), caption: z.string(), type: z.enum(['REELS', 'IMAGE', 'CAROUSEL_ALBUM', 'VIDEO']), permalink: z.string().nullable(), thumbnailUrl: z.string().nullable(), publishedAt: z.number(), reach: z.number().nullable(), likes: z.number().nullable(), comments: z.number().nullable(), shares: z.number().nullable(), saves: z.number().nullable() });
export const campaignSchema = z.object({ id: z.string(), accountId: z.string(), name: z.string(), status: z.enum(['draft', 'live', 'paused']), draft: campaignInputSchema, publishedTarget: targetSchema.nullable(), liveVersionId: z.string().nullable(), boundMediaId: z.string().nullable(), armedAt: z.number().nullable(), createdAt: z.number(), updatedAt: z.number() });
const contact = z.object({ id: z.string(), accountId: z.string(), instagramId: z.string(), username: z.string(), fields: z.record(z.string(), z.string()), tags: z.array(z.string()), lastInteractionAt: z.number().nullable(), createdAt: z.number() });
const message = z.object({ id: z.string(), accountId: z.string(), contactId: z.string(), runId: z.string().nullable(), direction: z.enum(['in', 'out']), channel: z.enum(['dm', 'public']), text: z.string(), buttons: z.array(buttonSchema), status: z.enum(['received', 'accepted', 'failed', 'uncertain']), createdAt: z.number() });
const run = z.object({ id: z.string(), accountId: z.string(), contactId: z.string(), campaignId: z.string(), versionId: z.string(), commentId: z.string(), mediaId: z.string(), nodeId: z.string().nullable(), state: z.enum(['running', 'waiting', 'delayed', 'complete', 'handoff', 'expired', 'failed', 'uncertain']), wakeAt: z.number().nullable(), createdAt: z.number(), updatedAt: z.number() });
const action = z.object({ id: z.string(), accountId: z.string(), runId: z.string(), nodeId: z.string(), kind: z.enum(['public', 'private', 'dm']), status: z.enum(['pending', 'executing', 'succeeded', 'failed', 'uncertain']), text: z.string(), attempts: z.number(), error: z.string().nullable(), createdAt: z.number(), updatedAt: z.number() });
const click = z.object({ id: z.string(), accountId: z.string(), campaignId: z.string(), runId: z.string(), contactId: z.string(), linkId: z.string(), automated: z.boolean(), createdAt: z.number() });
const processingJob = z.object({ id: z.string(), accountId: z.string(), kind: z.enum(['comment', 'response']), state: z.enum(['pending', 'queued', 'processing', 'failed']), attempts: z.number(), error: z.string().nullable(), availableAt: z.number(), receivedAt: z.number() });
export const bootstrapSchema = z.object({
  accounts: z.array(account), media: z.array(media), campaigns: z.array(campaignSchema), contacts: z.array(contact), messages: z.array(message), runs: z.array(run), actions: z.array(action), clicks: z.array(click), jobs: z.array(processingJob),
  metrics: z.object({ matchedComments: z.number(), openingAccepted: z.number(), linkMessagesAccepted: z.number(), buttonResponders: z.number(), uniqueClickers: z.number(), emailsCollected: z.number(), completedRuns: z.number(), failedActions: z.number() }),
  configuration: z.object({ demoEnabled: z.boolean(), metaConfigured: z.boolean(), publicBaseUrl: z.string(), webhookUrl: z.string(), callbackUrl: z.string(), graphVersion: z.string(), warnings: z.array(z.string()) }),
}) satisfies z.ZodType<Bootstrap>;

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function request(path: string, options?: { method?: string; body?: unknown }): Promise<unknown> {
  const response = await fetch(path, {
    method: options?.method ?? 'GET', credentials: 'same-origin',
    headers: options?.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z.object({ error: z.string(), details: z.array(z.string()).optional() }).safeParse(payload);
    throw new ApiError(error.success ? [error.data.error, ...(error.data.details ?? [])].join(' ') : `Request failed (${response.status}).`, response.status);
  }
  return payload;
}

export async function getBootstrap(query: string): Promise<Bootstrap> {
  const parsed = bootstrapSchema.safeParse(await request(`/api/bootstrap${query}`));
  if (!parsed.success) throw new Error('The dashboard received an unexpected response. Refresh or check the server configuration.');
  return parsed.data;
}

export async function getSession(): Promise<boolean> {
  return z.object({ authenticated: z.boolean() }).parse(await request('/api/session')).authenticated;
}
