import { createHmac, randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { z } from 'zod';
import { buttonSchema, campaignInputSchema, defaultCampaign, type CampaignInput } from '../../src/shared/domain';
import { readTemplate, writeTemplate } from '../../src/client/components/flow-model';

const stateSchema = z.object({
  accounts: z.array(z.object({ id: z.string(), mode: z.string() })),
  campaigns: z.array(z.object({ id: z.string(), accountId: z.string(), status: z.string(), liveVersionId: z.string().nullable(), boundMediaId: z.string().nullable(), armedAt: z.number().nullable(), draft: campaignInputSchema })),
  contacts: z.array(z.object({ id: z.string(), accountId: z.string(), username: z.string(), fields: z.record(z.string(), z.string()), lastInteractionAt: z.number().nullable() })),
  runs: z.array(z.object({ id: z.string(), accountId: z.string(), campaignId: z.string(), contactId: z.string(), versionId: z.string(), state: z.string(), nodeId: z.string().nullable(), wakeAt: z.number().nullable(), createdAt: z.number() })),
  messages: z.array(z.object({ id: z.string(), runId: z.string().nullable(), direction: z.string(), channel: z.string(), text: z.string(), status: z.string(), buttons: z.array(buttonSchema), createdAt: z.number() })),
  actions: z.array(z.object({ id: z.string(), runId: z.string(), status: z.string(), attempts: z.number() })),
  clicks: z.array(z.object({ runId: z.string(), automated: z.boolean() })),
  jobs: z.array(z.object({ id: z.string(), accountId: z.string(), state: z.string(), attempts: z.number(), availableAt: z.number(), error: z.string().nullable() })),
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

test('paced sends resume through the queue without a scheduler tick', async ({ request }) => {
  const created = await campaign(request);
  await post(request, '/api/demo/pacing', { accountId: 'demo-studio', milliseconds: 1000 });
  try {
    await comment(request, created.keyword, `paced-${randomUUID().slice(0, 8)}`);
    await expect.poll(async () => {
      const current = await state(request);
      const run = current.runs.find(item => item.campaignId === created.id);
      return current.messages.filter(item => item.runId === run?.id && item.direction === 'out' && item.channel === 'dm').length;
    }).toBe(1);
  } finally {
    await post(request, '/api/demo/pacing', { accountId: 'demo-studio', milliseconds: 0 });
  }
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

test('a button response survives a blocked opening send and concurrent scheduled work', async ({ request }) => {
  const created = await campaign(request, { publicReply: false });
  const username = `fast-${randomUUID().slice(0, 8)}`;
  await post(request, '/api/demo/send-barrier', { accountId: 'demo-studio', nodeId: 'opening', mode: 'arm' });
  const sending = request.post('/api/demo/comment', { data: { accountId: 'demo-studio', mediaId: 'demo-reel-guide', username, text: created.keyword } });
  await expect.poll(async () => {
    const response = await request.get('/api/demo/send-barrier?accountId=demo-studio&nodeId=opening');
    return z.object({ state: z.string() }).parse(await response.json()).state;
  }).toBe('blocked');
  const run = (await state(request)).runs.find(item => item.campaignId === created.id);
  if (!run) throw new Error('No blocked run');
  await Promise.all([
    post(request, '/api/demo/respond', { accountId: 'demo-studio', username, runId: run.id, buttonIndex: 0 }),
    post(request, '/api/demo/tick'),
  ]);
  await post(request, '/api/demo/send-barrier', { accountId: 'demo-studio', nodeId: 'opening', mode: 'release' });
  expect((await sending).ok()).toBeTruthy();
  const clock = z.object({ now: z.number() }).parse(await (await post(request, '/api/demo/tick')).json()).now;
  await post(request, '/api/demo/tick', { now: clock + 5000 });
  const current = await state(request);
  expect(current.runs.find(item => item.id === run.id)?.state).toBe('complete');
  expect(current.messages.filter(item => item.runId === run.id && item.text === 'Here is your guide. Enjoy!')).toHaveLength(1);
});

test('an email arriving before the prompt send returns is retained and captured', async ({ request }) => {
  const flow: CampaignInput['flow'] = { entry: 'opening', nodes: [
    { id: 'opening', kind: 'message', text: 'Ready to subscribe?', buttons: [{ kind: 'reply', label: 'Yes', next: 'email' }], next: null },
    { id: 'email', kind: 'collect', field: 'email', prompt: 'Which email?', next: 'done' },
    { id: 'done', kind: 'end', outcome: 'complete' },
  ] };
  const created = await campaign(request, { flow, publicReply: false });
  const username = `fast-email-${randomUUID().slice(0, 8)}`;
  await comment(request, created.keyword, username);
  const run = (await state(request)).runs.find(item => item.campaignId === created.id);
  if (!run) throw new Error('No email run');
  await post(request, '/api/demo/send-barrier', { accountId: 'demo-studio', nodeId: 'email', mode: 'arm' });
  const sending = request.post('/api/demo/respond', { data: { accountId: 'demo-studio', username, runId: run.id, buttonIndex: 0 } });
  await expect.poll(async () => {
    const response = await request.get('/api/demo/send-barrier?accountId=demo-studio&nodeId=email');
    return z.object({ state: z.string() }).parse(await response.json()).state;
  }).toBe('blocked');
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, text: 'fast@example.com' });
  await post(request, '/api/demo/send-barrier', { accountId: 'demo-studio', nodeId: 'email', mode: 'release' });
  expect((await sending).ok()).toBeTruthy();
  const clock = z.object({ now: z.number() }).parse(await (await post(request, '/api/demo/tick')).json()).now;
  await post(request, '/api/demo/tick', { now: clock + 5000 });
  const current = await state(request);
  expect(current.contacts.find(item => item.username === username)?.fields.email).toBe('fast@example.com');
  expect(current.runs.find(item => item.id === run.id)?.state).toBe('complete');
});

test('resource visits suppress the reminder without opening a new messaging window', async ({ request }) => {
  const flow: CampaignInput['flow'] = { entry: 'opening', nodes: [
    { id: 'opening', kind: 'message', text: 'Want the resource?', buttons: [{ kind: 'reply', label: 'Yes', next: 'resource' }], next: null },
    { id: 'resource', kind: 'message', text: 'Your resource.', buttons: [{ kind: 'url', label: 'Read', url: 'https://www.notion.so/reminder-resource' }], next: 'delay' },
    { id: 'delay', kind: 'delay', seconds: 60, next: 'check' },
    { id: 'check', kind: 'condition', field: '$link_clicked', operator: 'is_set', value: '', yes: 'done', no: 'reminder' },
    { id: 'reminder', kind: 'message', text: 'Remember your resource.', buttons: [], next: 'done' },
    { id: 'done', kind: 'end', outcome: 'complete' },
  ] };
  const created = await campaign(request, { flow, publicReply: false });
  for (const visited of [true, false]) {
    const username = `reminder-${visited}-${randomUUID().slice(0, 8)}`;
    await comment(request, created.keyword, username);
    let current = await state(request);
    const run = current.runs.find(item => item.campaignId === created.id && item.contactId === current.contacts.find(person => person.username === username)?.id);
    if (!run) throw new Error('No reminder run');
    await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, runId: run.id, buttonIndex: 0 });
    current = await state(request);
    if (visited) {
      const resource = current.messages.find(item => item.runId === run.id && item.text === 'Your resource.');
      const link = resource?.buttons.find(button => button.kind === 'url');
      if (!link || link.kind !== 'url') throw new Error('No reminder link');
      expect((await request.get(link.url, { maxRedirects: 0 })).status()).toBe(302);
    }
    const clock = z.object({ now: z.number() }).parse(await (await post(request, '/api/demo/tick')).json()).now;
    await post(request, '/api/demo/tick', { now: clock + 61000 });
    current = await state(request);
    expect(current.messages.filter(item => item.runId === run.id && item.text === 'Remember your resource.')).toHaveLength(visited ? 0 : 1);
    expect(current.runs.find(item => item.id === run.id)?.state).toBe('complete');
  }
});

test('guided email and follow confirmation gate multiple resources and reminders', async ({ request }) => {
  const initial = readTemplate(defaultCampaign('demo-studio').flow);
  if (!initial) throw new Error('Default campaign is not a guided flow.');
  const destinations = ['https://example.com/guide', 'https://example.com/checklist', 'https://example.com/course'];
  const flow = writeTemplate({ ...initial, opening: true, openingText: 'Opening permission', email: true, emailPrompt: 'Email before the resource?', follow: true, followText: 'Please follow, then confirm.', followButton: 'I am following', resourceText: 'Your resources are ready.', resourceLinks: destinations.map((url, index) => ({ kind: 'url', label: `Resource ${index + 1}`, url })), reminder: true, reminderText: 'Remember your resources.', reminderSeconds: 60 });
  const created = await campaign(request, { flow, publicReply: false });
  await post(request, '/api/demo/pacing', { accountId: 'demo-studio', milliseconds: 0 });
  for (const visitedLink of [-1, 0, 1, 2]) {
    const username = `guided-${randomUUID().slice(0, 8)}`;
    await comment(request, created.keyword, username);
    let current = await state(request);
    const person = current.contacts.find(item => item.username === username);
    const journey = current.runs.find(item => item.campaignId === created.id && item.contactId === person?.id);
    if (!journey) throw new Error('Guided campaign did not start.');
    const sent = () => current.messages.filter(item => item.runId === journey.id && item.direction === 'out' && item.channel === 'dm');
    expect(sent().map(item => item.text)).toEqual(['Opening permission']);
    await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, runId: journey.id, buttonIndex: 0 });
    current = await state(request);
    expect(current.runs.find(item => item.id === journey.id)?.nodeId).toBe('email');
    expect(sent().some(item => item.text === 'Please follow, then confirm.')).toBeFalsy();
    await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, text: 'not-an-email' });
    expect((await state(request)).runs.find(item => item.id === journey.id)?.nodeId).toBe('email');
    await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, text: 'reader@example.com' });
    current = await state(request);
    expect(current.runs.find(item => item.id === journey.id)?.nodeId).toBe('follow');
    expect(sent().some(item => item.text === 'Your resources are ready.')).toBeFalsy();
    await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, runId: journey.id, buttonIndex: 0 });
    current = await state(request);
    expect(sent().some(item => item.text === 'Your resources are ready.')).toBeFalsy();
    expect(sent().filter(item => item.text === 'Please follow, then confirm.')).toHaveLength(2);
    await post(request, '/api/demo/following', { accountId: 'demo-studio', username, status: 'following' });
    await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, runId: journey.id, buttonIndex: 0 });
    current = await state(request);
    const resource = sent().find(item => item.text === 'Your resources are ready.');
    if (!resource) throw new Error('No resource message was sent after confirmation.');
    expect(resource.buttons).toHaveLength(3);
    expect(current.runs.find(item => item.id === journey.id)?.state).toBe('delayed');
    const interactionBeforeClick = current.contacts.find(item => item.id === person?.id)?.lastInteractionAt;
    if (visitedLink >= 0) {
      const button = resource.buttons[visitedLink];
      if (button?.kind !== 'url') throw new Error('A resource URL button is missing.');
      const redirect = await request.get(button.url, { maxRedirects: 0 });
      expect(redirect.status()).toBe(302);
      expect(redirect.headers().location).toBe(destinations[visitedLink]);
      expect((await state(request)).contacts.find(item => item.id === person?.id)?.lastInteractionAt).toBe(interactionBeforeClick);
    }
    const clock = z.object({ now: z.number() }).parse(await (await post(request, '/api/demo/tick')).json()).now;
    await post(request, '/api/demo/tick', { now: clock + 61000 });
    current = await state(request);
    expect(sent().filter(item => item.text === 'Remember your resources.')).toHaveLength(visitedLink < 0 ? 1 : 0);
    expect(current.runs.find(item => item.id === journey.id)?.state).toBe('complete');
  }
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

test('an exhausted webhook job stays visible and recovers after the outage', async ({ request }) => {
  const created = await campaign(request, { publicReply: false });
  await post(request, '/api/demo/job-failure', { accountId: 'demo-studio', enabled: true });
  const eventId = randomUUID();
  await comment(request, created.keyword, `recover-${randomUUID().slice(0, 8)}`, { eventId });
  const jobId = `demo-studio:comment:${eventId}`;
  for (let attempt = 0; attempt < 22; attempt++) {
    const job = (await state(request)).jobs.find(item => item.id === jobId);
    if (!job || job.state === 'failed') break;
    await post(request, '/api/demo/tick', { now: job.availableAt + 1 });
  }
  let current = await state(request);
  const failed = current.jobs.find(item => item.id === jobId);
  expect(failed?.state).toBe('failed');
  expect(failed?.attempts).toBeGreaterThanOrEqual(20);
  expect(failed?.error).toBeTruthy();
  expect(current.runs.some(item => item.campaignId === created.id)).toBeFalsy();
  await post(request, '/api/demo/job-failure', { accountId: 'demo-studio', enabled: false });
  await post(request, `/api/jobs/${encodeURIComponent(jobId)}/retry`);
  await post(request, '/api/demo/tick');
  current = await state(request);
  expect(current.runs.filter(item => item.campaignId === created.id)).toHaveLength(1);
  expect(current.runs.find(item => item.campaignId === created.id)?.state).toBe('waiting');
  expect(current.jobs.some(item => item.id === jobId)).toBeFalsy();
});

test('confirmed account deletion removes dependent data and leaves other accounts intact', async ({ request }) => {
  const created = await campaign(request, { accountId: 'demo-notes', publicReply: false });
  const username = `delete-account-${randomUUID().slice(0, 8)}`;
  await post(request, '/api/demo/comment', { accountId: 'demo-notes', mediaId: 'demo-reel-notes', username, text: created.keyword });
  await post(request, '/api/demo/respond', { accountId: 'demo-notes', username, buttonIndex: 0 });
  const current = await state(request);
  const run = current.runs.find(item => item.campaignId === created.id);
  const resource = current.messages.find(item => item.runId === run?.id && item.text === 'Here is your guide. Enjoy!');
  const link = resource?.buttons.find(button => button.kind === 'url');
  if (!link || link.kind !== 'url') throw new Error('No account resource link');
  await request.get(link.url, { maxRedirects: 0 });
  expect((await request.delete('/api/accounts/demo-notes', { data: { confirmation: 'wrong' } })).status()).toBe(400);
  const removed = await request.delete('/api/accounts/demo-notes', { data: { confirmation: 'DELETE' } });
  expect(removed.ok(), await removed.text()).toBeTruthy();
  expect((await request.get(link.url, { maxRedirects: 0 })).status()).toBe(404);
  const after = await state(request);
  expect(after.accounts.some(item => item.id === 'demo-notes')).toBeFalsy();
  expect(after.accounts.some(item => item.id === 'demo-studio')).toBeTruthy();
  expect(after.campaigns.some(item => item.accountId === 'demo-notes')).toBeFalsy();
  expect(after.contacts.some(item => item.accountId === 'demo-notes')).toBeFalsy();
  expect(after.runs.some(item => item.accountId === 'demo-notes')).toBeFalsy();
  const exported = z.object({ versions: z.array(z.object({ campaignId: z.string() })), links: z.array(z.object({ accountId: z.string() })), metricSnapshots: z.array(z.object({ accountId: z.string() })) }).parse(await (await request.get('/api/export')).json());
  expect(exported.versions.some(item => item.campaignId === created.id)).toBeFalsy();
  expect(exported.links.some(item => item.accountId === 'demo-notes')).toBeFalsy();
  expect(exported.metricSnapshots.some(item => item.accountId === 'demo-notes')).toBeFalsy();
});

test('verified follow gate rejects text and duplicate taps, recovers lookup errors, and releases once', async ({ request }) => {
  const initial = readTemplate(defaultCampaign('demo-studio').flow);
  if (!initial) throw new Error('Missing guided template');
  const created = await campaign(request, { publicReply: false, flow: writeTemplate({ ...initial, follow: true, resourceText: 'Verified resource', followText: 'Please follow first.' }) });
  const username = `verified-${randomUUID().slice(0, 8)}`;
  await comment(request, created.keyword, username);
  let current = await state(request);
  const journey = current.runs.find(item => item.campaignId === created.id);
  if (!journey) throw new Error('Missing journey');
  const sent = () => current.messages.filter(item => item.runId === journey.id && item.direction === 'out');
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, buttonIndex: 0 });
  current = await state(request);
  expect(current.runs.find(item => item.id === journey.id)).toMatchObject({ state: 'waiting', nodeId: 'follow' });
  expect(sent().filter(item => item.text === 'Please follow first.')).toHaveLength(1);
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, text: 'I followed' });
  const repeated = { accountId: 'demo-studio', username, buttonIndex: 0, eventId: `follow-${randomUUID()}` };
  await post(request, '/api/demo/respond', repeated);
  await post(request, '/api/demo/respond', repeated);
  current = await state(request);
  expect(sent().filter(item => item.text === 'Please follow first.')).toHaveLength(2);
  expect(sent().some(item => item.text === 'Verified resource')).toBeFalsy();
  await post(request, '/api/demo/following', { accountId: 'demo-studio', username, status: 'unavailable' });
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, buttonIndex: 0 });
  current = await state(request);
  expect(current.runs.find(item => item.id === journey.id)?.nodeId).toBe('follow');
  expect(sent().some(item => item.text === 'Verified resource')).toBeFalsy();
  await post(request, '/api/demo/following', { accountId: 'demo-studio', username, status: 'following' });
  const clock = z.object({ now: z.number() }).parse(await (await post(request, '/api/demo/tick')).json()).now;
  await post(request, '/api/demo/tick', { now: clock + 61000 });
  current = await state(request);
  expect(sent().filter(item => item.text === 'Verified resource')).toHaveLength(1);
  expect(current.runs.find(item => item.id === journey.id)?.state).toBe('complete');
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, eventId: repeated.eventId, text: 'I followed' });
  current = await state(request);
  expect(sent().filter(item => item.text === 'Verified resource')).toHaveLength(1);
});

test('existing followers skip the follow prompt and uncertain repeats are retained', async ({ request }) => {
  const initial = readTemplate(defaultCampaign('demo-studio').flow);
  if (!initial) throw new Error('Missing template');
  const created = await campaign(request, { publicReply: false, flow: writeTemplate({ ...initial, follow: true, resourceText: 'Follow resource', followText: 'Follow prompt' }) });
  for (const following of [true, false]) {
    const username = `follow-state-${randomUUID().slice(0, 8)}`;
    await post(request, '/api/demo/following', { accountId: 'demo-studio', username, status: following ? 'following' : 'not_following' });
    await comment(request, created.keyword, username);
    let current = await state(request);
    const person = current.contacts.find(item => item.username === username);
    const journey = current.runs.find(item => item.campaignId === created.id && item.contactId === person?.id);
    if (!journey) throw new Error('Missing journey');
    await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, runId: journey.id, buttonIndex: 0 });
    current = await state(request);
    if (following) {
      expect(current.runs.find(item => item.id === journey.id)?.state).toBe('complete');
      expect(current.messages.some(item => item.runId === journey.id && item.text === 'Follow prompt')).toBeFalsy();
    } else {
      await post(request, '/api/demo/failure', { accountId: 'demo-studio', mode: 'uncertain' });
      await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, runId: journey.id, buttonIndex: 0 });
      current = await state(request);
      expect(current.runs.find(item => item.id === journey.id)?.state).toBe('uncertain');
      expect(current.messages.filter(item => item.runId === journey.id && item.text === 'Follow prompt').map(item => item.status).sort()).toEqual(['accepted', 'uncertain']);
      const count = current.actions.filter(item => item.runId === journey.id).length;
      await post(request, '/api/demo/tick');
      expect((await state(request)).actions.filter(item => item.runId === journey.id)).toHaveLength(count);
    }
  }
});

test('a verified follow tap survives a paced repeat sent after the tap', async ({ request }) => {
  const initial = readTemplate(defaultCampaign('demo-studio').flow);
  if (!initial) throw new Error('Missing guided template');
  const created = await campaign(request, { publicReply: false, flow: writeTemplate({ ...initial, follow: true, followText: 'Paced follow prompt', resourceText: 'Paced verified resource' }) });
  const username = `paced-follow-${randomUUID().slice(0, 8)}`;
  await comment(request, created.keyword, username);
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, buttonIndex: 0 });
  let current = await state(request);
  const journey = current.runs.find(item => item.campaignId === created.id);
  if (!journey) throw new Error('Missing journey');
  await post(request, '/api/demo/pacing', { accountId: 'demo-studio', milliseconds: 5000 });
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, buttonIndex: 0 });
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, buttonIndex: 0 });
  current = await state(request);
  expect(current.runs.find(item => item.id === journey.id)?.state).toBe('running');
  await post(request, '/api/demo/following', { accountId: 'demo-studio', username, status: 'following' });
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, buttonIndex: 0 });
  const time = z.object({ now: z.number() }).parse(await (await post(request, '/api/demo/tick')).json()).now;
  await post(request, '/api/demo/tick', { now: time + 6000 });
  await post(request, '/api/demo/tick', { now: time + 67000 });
  await post(request, '/api/demo/tick', { now: time + 73000 });
  current = await state(request);
  expect(current.runs.find(item => item.id === journey.id)?.state).toBe('complete');
  expect(current.messages.filter(item => item.runId === journey.id && item.text === 'Paced verified resource')).toHaveLength(1);
  await post(request, '/api/demo/pacing', { accountId: 'demo-studio', milliseconds: 0 });
});

test('one unavailable follow lookup does not block another account scheduled resource', async ({ request }) => {
  const initial = readTemplate(defaultCampaign('demo-studio').flow);
  if (!initial) throw new Error('Missing template');
  const blocked = await campaign(request, { publicReply: false, flow: writeTemplate({ ...initial, follow: true, resourceText: 'Blocked account resource' }) });
  const username = `outage-follow-${randomUUID().slice(0, 8)}`;
  await post(request, '/api/demo/following', { accountId: 'demo-studio', username, status: 'unavailable' });
  await comment(request, blocked.keyword, username);
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, buttonIndex: 0 });
  const other = await campaign(request, { accountId: 'demo-notes', publicReply: false, flow: { entry: 'opening', nodes: [
    { id: 'opening', kind: 'message', text: 'Other opening', buttons: [{ kind: 'reply', label: 'Continue', next: 'wait' }], next: null },
    { id: 'wait', kind: 'delay', seconds: 1, next: 'resource' },
    { id: 'resource', kind: 'message', text: 'Other scheduled resource', buttons: [], next: 'done' },
    { id: 'done', kind: 'end', outcome: 'complete' },
  ] } });
  const otherUsername = `other-follow-${randomUUID().slice(0, 8)}`;
  await post(request, '/api/demo/comment', { accountId: 'demo-notes', mediaId: 'demo-reel-notes', username: otherUsername, text: other.keyword });
  await post(request, '/api/demo/respond', { accountId: 'demo-notes', username: otherUsername, buttonIndex: 0 });
  const time = z.object({ now: z.number() }).parse(await (await post(request, '/api/demo/tick')).json()).now;
  await post(request, '/api/demo/tick', { now: time + 61000 });
  const current = await state(request);
  const blockedRun = current.runs.find(item => item.campaignId === blocked.id);
  const otherRun = current.runs.find(item => item.campaignId === other.id);
  expect(blockedRun).toMatchObject({ state: 'running', nodeId: 'follow' });
  expect(blockedRun?.wakeAt).toBeGreaterThan(time + 61000);
  expect(current.messages.some(item => item.runId === blockedRun?.id && item.text === 'Blocked account resource')).toBeFalsy();
  expect(otherRun?.state).toBe('complete');
  expect(current.messages.filter(item => item.runId === otherRun?.id && item.text === 'Other scheduled resource')).toHaveLength(1);
  await post(request, '/api/demo/following', { accountId: 'demo-studio', username, status: 'following' });
  await post(request, '/api/demo/tick', { now: time + 122000 });
  expect((await state(request)).runs.find(item => item.campaignId === blocked.id)?.state).toBe('complete');
});

test('legacy guided follow messages become verified gates and custom follow messages retain their meaning', async ({ request }) => {
  const legacy = defaultCampaign('demo-studio');
  legacy.publicReply = false;
  legacy.flow.nodes.splice(1, 0, { id: 'follow', kind: 'message', text: 'Legacy follow request', buttons: [{ kind: 'reply', label: 'I followed', next: 'resource' }], next: null });
  const opening = legacy.flow.nodes[0];
  if (opening?.kind !== 'message' || opening.buttons[0]?.kind !== 'reply') throw new Error('Missing opening button');
  opening.buttons[0].next = 'follow';
  const guided = await campaign(request, { flow: legacy.flow, publicReply: false });
  expect((await state(request)).campaigns.find(item => item.id === guided.id)?.draft.flow.nodes.find(node => node.id === 'follow')?.kind).toBe('follow');
  const username = `legacy-follow-${randomUUID().slice(0, 8)}`;
  await comment(request, guided.keyword, username);
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, buttonIndex: 0 });
  await post(request, '/api/demo/respond', { accountId: 'demo-studio', username, buttonIndex: 0 });
  let current = await state(request);
  const journey = current.runs.find(item => item.campaignId === guided.id);
  expect(journey).toMatchObject({ nodeId: 'follow', state: 'waiting' });
  expect(current.messages.filter(item => item.runId === journey?.id && item.text === 'Legacy follow request')).toHaveLength(2);
  opening.buttons.push({ kind: 'reply', label: 'Skip request', next: 'resource' });
  const custom = await campaign(request, { flow: legacy.flow, publicReply: false });
  current = await state(request);
  expect(current.campaigns.find(item => item.id === custom.id)?.draft.flow.nodes.find(node => node.id === 'follow')?.kind).toBe('message');
});
