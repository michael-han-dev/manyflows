import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { z } from 'zod';
import { buttonSchema, campaignInputSchema, defaultCampaign, type CampaignInput } from '../../src/shared/domain';

const stateSchema = z.object({
  accounts: z.array(z.object({ id: z.string(), mode: z.string() })),
  campaigns: z.array(z.object({ id: z.string(), accountId: z.string(), status: z.string(), liveVersionId: z.string().nullable(), boundMediaId: z.string().nullable(), armedAt: z.number().nullable(), draft: campaignInputSchema })),
  contacts: z.array(z.object({ id: z.string(), accountId: z.string(), username: z.string(), fields: z.record(z.string(), z.string()), lastInteractionAt: z.number().nullable() })),
  runs: z.array(z.object({ id: z.string(), accountId: z.string(), campaignId: z.string(), contactId: z.string(), versionId: z.string(), state: z.string(), nodeId: z.string().nullable(), wakeAt: z.number().nullable(), createdAt: z.number() })),
  messages: z.array(z.object({ id: z.string(), runId: z.string().nullable(), direction: z.string(), channel: z.string(), text: z.string(), status: z.string(), buttons: z.array(buttonSchema), createdAt: z.number() })),
  actions: z.array(z.object({ id: z.string(), runId: z.string(), status: z.string(), attempts: z.number() })),
  clicks: z.array(z.object({ runId: z.string(), automated: z.boolean() })),
});

async function post(request: APIRequestContext, path: string, data: unknown = {}) {
  const response = await request.post(path, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response;
}

async function state(request: APIRequestContext) {
  const response = await request.get('/api/bootstrap');
  expect(response.ok(), await response.text()).toBeTruthy();
  const body: unknown = await response.json();
  return stateSchema.parse(body);
}

async function campaign(request: APIRequestContext, update: Partial<CampaignInput> = {}) {
  const unique = randomUUID().slice(0, 8);
  const input = { ...defaultCampaign('demo-studio'), name: `Journey ${unique}`, matching: { mode: 'phrase', include: [unique], exclude: [] }, ...update } satisfies CampaignInput;
  const response = await post(request, '/api/campaigns', input);
  const saved = z.object({ id: z.string() }).parse(await response.json());
  await post(request, `/api/campaigns/${saved.id}/publish`);
  return { id: saved.id, input, keyword: input.matching.include[0] ?? 'GUIDE' };
}

async function comment(request: APIRequestContext, keyword: string, username: string, extra: Record<string, unknown> = {}) {
  return post(request, '/api/demo/comment', { accountId: 'demo-studio', mediaId: 'demo-reel-guide', username, text: keyword, ...extra });
}

test.beforeEach(async ({ request }) => {
  await post(request, '/api/login', { password: 'e2e-local-password' });
  await post(request, '/api/demo/seed');
});

test('owner authentication protects data and export', async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:8788' });
  expect((await anonymous.get('/api/bootstrap')).status()).toBe(401);
  expect((await anonymous.get('/api/export')).status()).toBe(401);
  expect((await anonymous.post('/api/login', { data: { password: 'wrong' } })).status()).toBe(401);
  const login = await anonymous.post('/api/login', { data: { password: 'e2e-local-password' } });
  expect(login.ok()).toBeTruthy();
  expect(login.headers()['set-cookie']).toContain('HttpOnly');
  const exported = await anonymous.get('/api/export');
  expect(exported.ok()).toBeTruthy();
  const contents = await exported.text();
  expect(contents).not.toContain('e2e-meta-secret');
  expect(contents).not.toContain('e2e-local-password');
  await post(anonymous, '/api/logout');
  expect((await anonymous.get('/api/bootstrap')).status()).toBe(401);
  await anonymous.dispose();
});

test('comment journey collects email, delivers a tracked link, and deduplicates events', async ({ request }) => {
  const flow: CampaignInput['flow'] = { entry: 'opening', nodes: [
    { id: 'opening', kind: 'message', text: 'Want the Notion guide?', buttons: [{ kind: 'reply', label: 'Yes, please', next: 'email' }], next: null },
    { id: 'email', kind: 'collect', field: 'email', prompt: 'Where should we send updates?', next: 'resource' },
    { id: 'resource', kind: 'message', text: 'Your Notion guide is ready.', buttons: [{ kind: 'url', label: 'Open guide', url: 'https://www.notion.so/example-guide' }], next: 'done' },
    { id: 'done', kind: 'end', outcome: 'complete' },
  ] };
  const created = await campaign(request, { flow, replyVariations: ['First reply', 'Second reply', 'Third reply', 'Fourth reply', 'Fifth reply'] });
  const username = `reader-${randomUUID().slice(0, 8)}`;
  const eventId = randomUUID();
  await comment(request, created.keyword, username, { eventId });
  let current = await state(request);
  const run = current.runs.find(item => item.campaignId === created.id);
  expect(run).toBeDefined();
  if (!run) throw new Error('The comment did not start a run');
  expect(run.state).toBe('waiting');
  const first = current.messages.filter(item => item.runId === run.id && item.direction === 'out');
  expect(first.filter(item => item.channel === 'public')).toHaveLength(1);
  expect(first.filter(item => item.channel === 'dm')).toHaveLength(1);
  expect(first.some(item => item.text.includes('Your Notion guide is ready.'))).toBeFalsy();
  await comment(request, created.keyword, username, { eventId });
  expect((await state(request)).messages.filter(item => item.runId === run.id && item.direction === 'out')).toHaveLength(first.length);
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, runId: run.id, buttonIndex: 0 });
  current = await state(request);
  expect(current.messages.some(item => item.runId === run.id && item.text === 'Where should we send updates?')).toBeTruthy();
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, text: 'not an email' });
  expect((await state(request)).runs.find(item => item.id === run.id)?.state).toBe('waiting');
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, text: 'reader@example.com' });
  current = await state(request);
  expect(current.contacts.find(item => item.username === username)?.fields.email).toBe('reader@example.com');
  expect(current.runs.find(item => item.id === run.id)?.state).toBe('complete');
  const resource = current.messages.find(item => item.runId === run.id && item.text === 'Your Notion guide is ready.');
  const link = resource?.buttons.find(button => button.kind === 'url');
  if (!link || link.kind !== 'url') throw new Error('No tracked resource button was stored');
  expect(new URL(link.url).pathname).toMatch(/^\/r\//);
  const before = current.contacts.find(item => item.username === username)?.lastInteractionAt;
  const redirect = await request.get(link.url, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers().location).toBe('https://www.notion.so/example-guide');
  expect(redirect.headers()['cache-control']).toContain('no-store');
  current = await state(request);
  expect(current.clicks.some(item => item.runId === run.id && !item.automated)).toBeTruthy();
  expect(current.contacts.find(item => item.username === username)?.lastInteractionAt).toBe(before);
});

test('accounts remain isolated and the same username does not merge across accounts', async ({ request }) => {
  const one = await campaign(request);
  const two = await campaign(request, { accountId: 'demo-notes', matching: one.input.matching, publicReply: false });
  const username = `shared-${randomUUID().slice(0, 8)}`;
  await comment(request, one.keyword, username);
  await post(request, '/api/demo/comment', { accountId: 'demo-notes', mediaId: 'demo-reel-notes', username, text: one.keyword });
  const current = await state(request);
  const contacts = current.contacts.filter(item => item.username === username);
  expect(contacts).toHaveLength(2);
  expect(new Set(contacts.map(item => item.id)).size).toBe(2);
  expect(current.runs.some(item => item.campaignId === one.id && item.accountId === 'demo-studio')).toBeTruthy();
  expect(current.runs.some(item => item.campaignId === two.id && item.accountId === 'demo-notes')).toBeTruthy();
  const filtered = await request.get('/api/bootstrap?accountId=demo-studio');
  const body = stateSchema.parse(await filtered.json());
  expect(body.contacts.every(item => item.accountId === 'demo-studio')).toBeTruthy();
  expect(body.runs.every(item => item.accountId === 'demo-studio')).toBeTruthy();
});

test('published versions remain immutable for waiting conversations', async ({ request }) => {
  const created = await campaign(request);
  const username = `version-${randomUUID().slice(0, 8)}`;
  await comment(request, created.keyword, username);
  const original = (await state(request)).runs.find(item => item.campaignId === created.id);
  if (!original) throw new Error('No original run');
  const changed = { ...created.input, flow: { ...created.input.flow, nodes: created.input.flow.nodes.map(node => node.kind === 'message' && node.id === 'resource' ? { ...node, text: 'A different resource for new readers.' } : node) } };
  const update = await request.put(`/api/campaigns/${created.id}`, { data: changed });
  expect(update.ok(), await update.text()).toBeTruthy();
  await post(request, `/api/campaigns/${created.id}/publish`);
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, runId: original.id, buttonIndex: 0 });
  const current = await state(request);
  expect(current.runs.find(item => item.id === original.id)?.versionId).toBe(original.versionId);
  expect(current.campaigns.find(item => item.id === created.id)?.liveVersionId).not.toBe(original.versionId);
  expect(current.messages.some(item => item.runId === original.id && item.text === 'Here is your guide. Enjoy!')).toBeTruthy();
  expect(current.messages.some(item => item.runId === original.id && item.text === 'A different resource for new readers.')).toBeFalsy();
});

test('publication rejects broken graphs and unsupported cycles', async ({ request }) => {
  const input = defaultCampaign('demo-studio');
  input.flow = { entry: 'opening', nodes: [{ id: 'opening', kind: 'message', text: 'Broken', buttons: [], next: 'missing' }] };
  const saved = await request.post('/api/campaigns', { data: input });
  if (saved.ok()) {
    const { id } = z.object({ id: z.string() }).parse(await saved.json());
    expect((await request.post(`/api/campaigns/${id}/publish`)).status()).toBe(400);
  } else expect(saved.status()).toBe(400);
  input.flow.nodes = [{ id: 'opening', kind: 'message', text: 'Loop', buttons: [], next: 'opening' }];
  const cyclic = await request.post('/api/campaigns', { data: input });
  if (cyclic.ok()) {
    const { id } = z.object({ id: z.string() }).parse(await cyclic.json());
    expect((await request.post(`/api/campaigns/${id}/publish`)).status()).toBe(400);
  } else expect(cyclic.status()).toBe(400);
});

test('next-post campaigns bind by publication time including a post without comments', async ({ request }) => {
  const created = await campaign(request, { target: { kind: 'next' } });
  const firstId = `next-first-${randomUUID().slice(0, 8)}`;
  const laterId = `next-later-${randomUUID().slice(0, 8)}`;
  const publishedAt = Date.now();
  await post(request, '/api/demo/media', { accountId: 'demo-studio', id: firstId, caption: 'First new publication', publishedAt, type: 'REELS' });
  await post(request, '/api/demo/media', { accountId: 'demo-studio', id: laterId, caption: 'Later publication', publishedAt: publishedAt + 1, type: 'REELS' });
  await comment(request, created.keyword, `later-${randomUUID().slice(0, 8)}`, { mediaId: laterId });
  await post(request, '/api/demo/tick');
  let current = await state(request);
  expect(current.campaigns.find(item => item.id === created.id)?.boundMediaId).toBe(firstId);
  expect(current.runs.filter(item => item.campaignId === created.id)).toHaveLength(0);
  await comment(request, created.keyword, `first-${randomUUID().slice(0, 8)}`, { mediaId: firstId });
  current = await state(request);
  expect(current.runs.filter(item => item.campaignId === created.id)).toHaveLength(1);
});

test('webhook verification rejects invalid signatures and accepts the configured challenge', async ({ request }) => {
  const challenge = await request.get('/webhooks/instagram?hub.mode=subscribe&hub.verify_token=e2e-verify-token&hub.challenge=challenge-proof');
  expect(challenge.status()).toBe(200);
  expect(await challenge.text()).toBe('challenge-proof');
  expect((await request.get('/webhooks/instagram?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=no')).status()).toBe(403);
  const payload = JSON.stringify({ object: 'instagram', entry: [] });
  expect((await request.post('/webhooks/instagram', { data: payload, headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=bad' } })).status()).toBe(401);
  const signature = createHmac('sha256', 'e2e-meta-secret').update(payload).digest('hex');
  const valid = await request.post('/webhooks/instagram', { data: payload, headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` } });
  expect(valid.ok(), await valid.text()).toBeTruthy();
});

test('old contact interactions do not expire a new comment journey', async ({ request }) => {
  const created = await campaign(request, { publicReply: false });
  const username = `returning-${randomUUID().slice(0, 8)}`;
  await comment(request, 'unmatched old conversation', username);
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, text: 'Old DM', timestamp: Date.now() - 30 * 86400000 });
  await comment(request, created.keyword, username);
  await post(request, '/api/demo/tick');
  const run = (await state(request)).runs.find(item => item.campaignId === created.id);
  expect(run?.state).toBe('waiting');
  if (!run) throw new Error('No new journey for returning contact');
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, runId: run.id, buttonIndex: 0 });
  expect((await state(request)).runs.find(item => item.id === run.id)?.state).toBe('complete');
});

test('next publication and comments support provider timestamps rounded to seconds', async ({ request }) => {
  const created = await campaign(request, { target: { kind: 'next' }, publicReply: false });
  const armedAt = (await state(request)).campaigns.find(item => item.id === created.id)?.armedAt;
  if (!armedAt) throw new Error('No arming timestamp');
  const rounded = Math.floor(armedAt / 1000) * 1000;
  const mediaId = `rounded-${randomUUID().slice(0, 8)}`;
  await post(request, '/api/demo/media', { accountId: 'demo-studio', id: mediaId, caption: 'Same-second publication', publishedAt: rounded, type: 'REELS' });
  await comment(request, created.keyword, `rounded-${randomUUID().slice(0, 8)}`, { mediaId, timestamp: rounded });
  const current = await state(request);
  expect(current.campaigns.find(item => item.id === created.id)?.boundMediaId).toBe(mediaId);
  expect(current.runs.some(item => item.campaignId === created.id)).toBeTruthy();
});

test('an older message cannot answer a later email prompt', async ({ request }) => {
  const flow: CampaignInput['flow'] = { entry: 'opening', nodes: [
    { id: 'opening', kind: 'message', text: 'Ready?', buttons: [{ kind: 'reply', label: 'Yes', next: 'email' }], next: null },
    { id: 'email', kind: 'collect', field: 'email', prompt: 'Your email?', next: 'done' },
    { id: 'done', kind: 'end', outcome: 'complete' },
  ] };
  const created = await campaign(request, { flow, publicReply: false });
  const username = `ordered-${randomUUID().slice(0, 8)}`;
  await comment(request, created.keyword, username);
  const run = (await state(request)).runs.find(item => item.campaignId === created.id);
  if (!run) throw new Error('No ordered conversation');
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, runId: run.id, buttonIndex: 0 });
  let current = await state(request);
  const prompt = current.messages.find(item => item.runId === run.id && item.text === 'Your email?');
  if (!prompt || prompt.createdAt <= run.createdAt) throw new Error('Prompt must follow run creation');
  const staleTime = Math.floor((run.createdAt + prompt.createdAt) / 2);
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, text: 'stale@example.com', timestamp: staleTime });
  current = await state(request);
  expect(current.contacts.find(item => item.username === username)?.fields.email).toBeUndefined();
  expect(current.runs.find(item => item.id === run.id)?.state).toBe('waiting');
});

test('uncertain external sends are visible and never automatically repeated', async ({ request }) => {
  const created = await campaign(request, { publicReply: false });
  await post(request, '/api/demo/failure', { accountId: 'demo-studio', mode: 'uncertain' });
  await comment(request, created.keyword, `uncertain-${randomUUID().slice(0, 8)}`);
  let current = await state(request);
  const run = current.runs.find(item => item.campaignId === created.id);
  if (!run) throw new Error('No run after uncertain send');
  const action = current.actions.find(item => item.runId === run.id);
  expect(action?.status).toBe('uncertain');
  const attempts = action?.attempts;
  await post(request, '/api/demo/tick', { now: Date.now() + 600000 });
  current = await state(request);
  expect(current.actions.find(item => item.id === action?.id)?.attempts).toBe(attempts);
  expect(current.runs.find(item => item.id === run.id)?.state).toBe('uncertain');
});

test('delayed messages recheck the messaging window before sending', async ({ request }) => {
  const flow: CampaignInput['flow'] = { entry: 'opening', nodes: [
    { id: 'opening', kind: 'message', text: 'Would you like a reminder?', buttons: [{ kind: 'reply', label: 'Yes', next: 'wait' }], next: null },
    { id: 'wait', kind: 'delay', seconds: 90000, next: 'late' },
    { id: 'late', kind: 'message', text: 'This message must expire.', buttons: [], next: 'done' },
    { id: 'done', kind: 'end', outcome: 'complete' },
  ] };
  const created = await campaign(request, { flow, publicReply: false });
  const username = `expiry-${randomUUID().slice(0, 8)}`;
  await comment(request, created.keyword, username);
  const run = (await state(request)).runs.find(item => item.campaignId === created.id);
  if (!run) throw new Error('No delayed run');
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, runId: run.id, buttonIndex: 0 });
  let current = await state(request);
  expect(current.runs.find(item => item.id === run.id)?.state).toBe('delayed');
  await post(request, '/api/demo/tick', { now: Date.now() + 91000 * 1000 });
  current = await state(request);
  expect(current.runs.find(item => item.id === run.id)?.state).toBe('expired');
  expect(current.messages.some(item => item.runId === run.id && item.text === 'This message must expire.')).toBeFalsy();
});
