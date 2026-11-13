import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { defaultCampaign } from '../../src/shared/domain';

test('a waiting conversation and owner session survive a real Worker restart', async () => {
  test.setTimeout(90000);
  const base = 'http://127.0.0.1:8789';
  const configPath = resolve('.wrangler/restart.config.json');
  const persist = resolve('.wrangler/restart-check-state');
  const original: unknown = JSON.parse(readFileSync('.wrangler/e2e.config.json', 'utf8'));
  const config = z.object({ vars: z.record(z.string(), z.string()) }).passthrough().parse(original);
  writeFileSync(configPath, JSON.stringify({ ...config, name: 'relay-restart-check', vars: { ...config.vars, PUBLIC_BASE_URL: base } }));
  rmSync(persist, { recursive: true, force: true });
  const env: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve('.wrangler/restart-logs') };
  delete env.CLOUDFLARE_ENV;
  const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
  const migration = spawnSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', persist], { env, encoding: 'utf8' });
  expect(migration.status, migration.stdout + migration.stderr).toBe(0);
  let server: ChildProcess | undefined;
  let logs = '';
  let cookie = '';
  async function start() {
    server = spawn(process.execPath, [wrangler, 'dev', '--local', '--port', '8789', '--config', configPath, '--persist-to', persist], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout?.on('data', chunk => { logs += String(chunk); });
    server.stderr?.on('data', chunk => { logs += String(chunk); });
    await expect.poll(async () => { try { return (await fetch(`${base}/api/session`)).status; } catch { return 0; } }, { timeout: 30000, message: logs }).toBe(200);
  }
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
    server = undefined;
  }
  async function call(path: string, data?: unknown) {
    const response = await fetch(`${base}${path}`, { method: data === undefined ? 'GET' : 'POST', headers: { ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    expect(response.ok, `${path}: ${await response.clone().text()}`).toBeTruthy();
    return response;
  }
  const snapshotSchema = z.object({ runs: z.array(z.object({ id: z.string(), campaignId: z.string(), versionId: z.string(), state: z.string() })), messages: z.array(z.object({ runId: z.string().nullable(), text: z.string(), direction: z.string() })) });
  try {
    await start();
    const login = await call('/api/login', { password: 'e2e-local-password' });
    cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(cookie).toContain('owner_session=');
    await call('/api/demo/seed', {});
    const input = { ...defaultCampaign('demo-studio'), name: 'Restart proof', publicReply: false };
    const campaign = z.object({ id: z.string() }).parse(await (await call('/api/campaigns', input)).json());
    await call(`/api/campaigns/${campaign.id}/publish`, {});
    await call('/api/demo/comment', { accountId: 'demo-studio', mediaId: 'demo-reel-guide', username: 'restart-reader', text: 'GUIDE' });
    const before = snapshotSchema.parse(await (await call('/api/bootstrap')).json());
    const run = before.runs.find(item => item.campaignId === campaign.id);
    expect(run?.state).toBe('waiting');
    if (!run) throw new Error('No waiting run before restart');
    await stop();
    await start();
    const restored = snapshotSchema.parse(await (await call('/api/bootstrap')).json());
    expect(restored.runs.find(item => item.id === run.id)).toEqual(run);
    await call('/api/demo/respond', { accountId: 'demo-studio', username: 'restart-reader', runId: run.id, buttonIndex: 0 });
    const after = snapshotSchema.parse(await (await call('/api/bootstrap')).json());
    expect(after.runs.find(item => item.id === run.id)?.state).toBe('complete');
    expect(after.messages.filter(item => item.runId === run.id && item.direction === 'out' && item.text === 'Here is your guide. Enjoy!')).toHaveLength(1);
  } finally {
    await stop();
  }
});
