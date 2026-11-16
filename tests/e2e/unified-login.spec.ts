import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { z } from 'zod';
import { defaultCampaign } from '../../src/shared/domain';

const accountsSchema = z.object({ accounts: z.array(z.object({ id: z.string(), status: z.string(), mode: z.string() })) });

async function login(request: APIRequestContext) {
  expect((await request.post('/api/login', { data: { password: 'e2e-local-password' } })).ok()).toBeTruthy();
}

async function state(request: APIRequestContext) {
  const response = await request.get('/api/accounts/connect', { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  const url = new URL(response.headers().location);
  expect(url.origin + url.pathname).toBe('https://www.facebook.com/dialog/oauth');
  expect(url.searchParams.get('client_id')).toBe('example_meta_app');
  expect(url.searchParams.get('config_id')).toBe('example_login_config');
  expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8788/auth/instagram/callback');
  expect(url.searchParams.get('response_type')).toBe('code');
  const signed = url.searchParams.get('state');
  expect(signed).toBeTruthy();
  return signed ?? '';
}

async function callback(request: APIRequestContext, signed: string, params: Record<string, string>) {
  return request.get('/auth/instagram/callback', { params: { state: signed, ...params }, maxRedirects: 0 });
}

async function connect(request: APIRequestContext, scenario: string) {
  const response = await callback(request, await state(request), { code: `example_${scenario}` });
  expect(response.status(), await response.text()).toBe(302);
  return new URL(response.headers().location).searchParams.get('connection');
}

async function accounts(request: APIRequestContext) {
  const response = await request.get('/api/bootstrap');
  expect(response.ok()).toBeTruthy();
  return accountsSchema.parse(await response.json()).accounts.filter(account => account.mode === 'live');
}

function database(sql: string) {
  const directory = resolve('.wrangler/e2e-state/v3/d1/miniflare-D1DatabaseObject');
  const [file, ...other] = readdirSync(directory).filter(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
  if (!file || other.length) throw new Error('Expected one local D1 database');
  return execFileSync('sqlite3', ['-json', resolve(directory, file), sql], { encoding: 'utf8' });
}

test.beforeEach(() => { database("DELETE FROM settings WHERE key='clock'"); });

test('signed login state is bound to the owner session and consumed on cancellation', async ({ request, playwright }) => {
  await login(request);
  const other = await playwright.request.newContext({ baseURL: 'http://127.0.0.1:8788' });
  try {
    await login(other);
    const signed = await state(request);
    expect((await callback(other, signed, { code: 'example_success' })).status()).toBe(403);
    const cancelled = await callback(request, signed, { error: 'access_denied', error_description: 'example private cancellation' });
    expect(cancelled.status()).toBe(302);
    expect(new URL(cancelled.headers().location).searchParams.get('connection')).toBe('cancelled');
    expect(cancelled.headers().location).not.toContain('example private cancellation');
    expect((await callback(request, signed, { code: 'example_success' })).status()).toBe(400);
  } finally {
    await other.dispose();
  }
});

test('shared business grant reconciles discovery, failures, expiry and revocation', async ({ request }) => {
  await login(request);
  expect(await connect(request, 'success')).toBe('connected');
  expect(await accounts(request)).toMatchObject([{ id: 'example_ig_1', status: 'connected' }, { id: 'example_ig_2', status: 'connected' }]);
  const campaignResponse = await request.post('/api/campaigns', { data: defaultCampaign('example_ig_1') });
  expect(campaignResponse.status()).toBe(201);
  const campaign = z.object({ id: z.string() }).parse(await campaignResponse.json());
  expect((await request.post(`/api/campaigns/${campaign.id}/publish`)).ok()).toBeTruthy();
  const webhook = JSON.stringify({ object: 'instagram', entry: [{ id: 'example_ig_1', changes: [{ field: 'comments', value: { id: 'example_comment', from: { id: 'example_sender', username: 'example_reader' }, media: { id: 'example_media' }, text: 'GUIDE' } }] }] });
  const signature = createHmac('sha256', 'e2e-meta-secret').update(webhook).digest('hex');
  expect((await request.post('/webhooks/instagram', { data: webhook, headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${signature}` } })).ok()).toBeTruthy();
  await expect.poll(async () => {
    const result = z.object({ messages: z.array(z.object({ accountId: z.string(), direction: z.string(), status: z.string() })) }).parse(await (await request.get('/api/bootstrap')).json());
    return result.messages.filter(message => message.accountId === 'example_ig_1' && message.direction === 'out' && message.status === 'accepted').length;
  }).toBe(2);
  const stored = database("SELECT id, token, expires_at FROM meta_grants WHERE client_business_id='example_business'");
  const grants = z.array(z.object({ id: z.string(), token: z.string(), expires_at: z.number().nullable() })).parse(JSON.parse(stored));
  expect(grants).toHaveLength(1);
  expect(grants[0]?.token).not.toContain('example_token_success');
  const memberships = database("SELECT id, grant_id FROM accounts WHERE id IN ('example_ig_1','example_ig_2') ORDER BY id");
  expect(z.array(z.object({ id: z.string(), grant_id: z.string() })).parse(JSON.parse(memberships)).map(row => row.grant_id)).toEqual([grants[0]?.id, grants[0]?.id]);
  for (const path of ['/api/bootstrap', '/api/export']) {
    const text = await (await request.get(path)).text();
    expect(text).not.toContain('example_token_success');
    expect(text).not.toContain('e2e-meta-secret');
    expect(text).not.toContain(grants[0]?.token ?? 'missing encrypted token');
  }
  for (const scenario of ['discovery_failure', 'empty_cursor', 'cursor_loop', 'conflicting_duplicate']) {
    expect(await connect(request, scenario)).toBe('failed');
    expect((await accounts(request)).map(account => account.id)).toEqual(['example_ig_1', 'example_ig_2']);
  }
  expect(await connect(request, 'hostile')).toBe('connected');
  expect((await accounts(request)).map(account => account.id)).toEqual(['example_ig_1', 'example_ig_2']);
  expect(await connect(request, 'partial')).toBe('partial');
  expect(await accounts(request)).toMatchObject([{ id: 'example_ig_1', status: 'connected' }, { id: 'example_ig_2', status: 'restricted' }]);
  expect(await connect(request, 'reauth')).toBe('connected');
  expect(await accounts(request)).toMatchObject([{ id: 'example_ig_1', status: 'connected' }, { id: 'example_ig_2', status: 'reconnect' }]);
  expect(await connect(request, 'success')).toBe('connected');
  database("UPDATE meta_grants SET expires_at=1 WHERE client_business_id='example_business'");
  expect((await accounts(request)).map(account => account.status)).toEqual(['reconnect', 'reconnect']);
  expect(await connect(request, 'revoked')).toBe('partial');
  expect((await accounts(request)).map(account => account.status)).toEqual(['reconnect', 'reconnect']);
  expect(await connect(request, 'success')).toBe('connected');
  database("INSERT INTO events(id,account_id,payload,received_at) VALUES('example_busy_event','example_ig_1','{}',1); INSERT INTO outbox(id,event_id,state,available_at) VALUES('example_busy_job','example_busy_event','processing',1)");
  expect((await request.delete('/api/accounts/example_ig_1', { data: { confirmation: 'DELETE' } })).status()).toBe(409);
  expect((await accounts(request)).map(account => account.id)).toEqual(['example_ig_1', 'example_ig_2']);
  database("DELETE FROM outbox WHERE id='example_busy_job'; DELETE FROM events WHERE id='example_busy_event'");
  const deleted = await request.delete('/api/accounts/example_ig_1', { data: { confirmation: 'DELETE' } });
  expect(deleted.ok(), await deleted.text()).toBeTruthy();
  expect(await accounts(request)).toMatchObject([{ id: 'example_ig_2', status: 'connected' }]);
  expect(z.array(z.object({ n: z.number() })).parse(JSON.parse(database('SELECT COUNT(*) AS n FROM meta_grants')))[0]?.n).toBe(1);
  expect((await request.delete('/api/accounts/example_ig_2', { data: { confirmation: 'DELETE' } })).ok()).toBeTruthy();
  expect(z.array(z.object({ n: z.number() })).parse(JSON.parse(database('SELECT COUNT(*) AS n FROM meta_grants')))[0]?.n).toBe(0);
});
