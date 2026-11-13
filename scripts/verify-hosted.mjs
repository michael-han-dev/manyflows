import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
const origin = new URL(config.vars.PUBLIC_BASE_URL).origin;
assert.equal(new URL(origin).protocol, 'https:');
const html = await readFile('dist/index.html', 'utf8');
const asset = html.match(/src="([^"]+\.js)"/)?.[1];
assert(asset, 'Build the dashboard before checking its hosted assets.');
const probes = [
  ...['/', '/api/accounts', '/api/export', '/api/login', '/auth/instagram/callback', asset].map(route => ({ label: route, route, status: 302, access: true })),
  { label: 'Unauthenticated login POST', route: '/api/login', method: 'POST', body: JSON.stringify({ password: 'invalid-hosted-verification-password' }), status: 302, access: true },
  { label: 'Untrusted identity header', route: '/api/accounts', headers: { 'Cf-Access-Authenticated-User-Email': 'untrusted@example.com' }, status: 302, access: true },
  { label: 'Missing recipient link', route: '/r/hosted-verification-missing-link', status: 404, text: 'Link not found.' },
  { label: 'Invalid webhook verification', route: '/webhooks/instagram', status: 403, text: 'Invalid verification token.' },
  { label: 'Unsigned webhook POST', route: '/webhooks/instagram', method: 'POST', body: '{}', status: 401, jsonError: 'Invalid webhook signature.' },
];

const secretsFile = '.dev.vars.production.json';
const localSecrets = existsSync(secretsFile) ? JSON.parse(await readFile(secretsFile, 'utf8')) : {};
const verificationToken = process.env.META_WEBHOOK_VERIFY_TOKEN ?? localSecrets.META_WEBHOOK_VERIFY_TOKEN;
if (verificationToken) {
  const challenge = new URL('/webhooks/instagram', origin);
  challenge.searchParams.set('hub.mode', 'subscribe');
  challenge.searchParams.set('hub.verify_token', verificationToken);
  challenge.searchParams.set('hub.challenge', 'relay-hosted-verification');
  probes.push({ label: 'Valid webhook challenge', route: challenge.pathname + challenge.search, status: 200, text: 'relay-hosted-verification' });
}

const evidence = [];
for (const probe of probes) {
  const response = await fetch(new URL(probe.route, origin), {
    method: probe.method ?? 'GET',
    redirect: 'manual',
    headers: { ...(probe.body ? { 'Content-Type': 'application/json' } : {}), ...probe.headers },
    ...(probe.body ? { body: probe.body } : {}),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, probe.status, `${probe.label}: unexpected status`);
  if (probe.access) {
    const location = response.headers.get('location');
    assert(location && new URL(location, origin).hostname.endsWith('.cloudflareaccess.com'), `${probe.label}: Access must require authentication`);
  }
  if (probe.text !== undefined) assert.equal(await response.text(), probe.text, probe.label);
  if (probe.jsonError !== undefined) assert.equal((await response.json()).error, probe.jsonError, probe.label);
  evidence.push({ label: probe.label, method: probe.method ?? 'GET', status: response.status });
  console.log(`Passed: ${probe.label}`);
}

await mkdir('.wrangler', { recursive: true });
await writeFile('.wrangler/hosted-verification.json', JSON.stringify({ verified_at: new Date().toISOString(), origin, evidence }, null, 2) + '\n', { mode: 0o600 });
console.log(`${evidence.length} hosted checks passed. Owner sign-in and real Instagram delivery require separate verification.`);
