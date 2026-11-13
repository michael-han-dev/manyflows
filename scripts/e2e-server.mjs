import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
mkdirSync('.wrangler', { recursive: true });
const configPath = resolve('.wrangler/e2e.config.json');
writeFileSync(configPath, JSON.stringify({
  name: 'relay-e2e',
  main: resolve('src/server/index.ts'),
  compatibility_date: '2026-11-13',
  compatibility_flags: ['nodejs_compat'],
  assets: { directory: resolve('dist'), binding: 'ASSETS', not_found_handling: 'single-page-application', run_worker_first: ['/api/*', '/webhooks/*', '/auth/*', '/r/*'] },
  d1_databases: [{ binding: 'DB', database_name: 'relay-e2e', database_id: '00000000-0000-0000-0000-000000000001', migrations_dir: resolve('migrations') }],
  queues: { producers: [{ binding: 'OUTBOX', queue: 'relay-e2e-jobs' }], consumers: [{ queue: 'relay-e2e-jobs', max_batch_size: 10, max_retries: 3 }] },
  vars: {
    ADMIN_PASSWORD: 'e2e-local-password',
    SESSION_SECRET: 'e2e-session-secret-at-least-32-characters',
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    META_APP_SECRET: 'e2e-meta-secret',
    META_WEBHOOK_VERIFY_TOKEN: 'e2e-verify-token',
    DEMO_MODE: 'true',
    PUBLIC_BASE_URL: 'http://127.0.0.1:8788',
    GRAPH_VERSION: 'v27.0',
  },
}, null, 2));
const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
const state = resolve('.wrangler/e2e-state');
rmSync(state, { recursive: true, force: true });
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve('.wrangler/logs'), CLOUDFLARE_ENV: 'e2e' };
const migrate = spawnSync(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'DB', '--local', '--config', configPath, '--persist-to', state], { cwd: root, env, stdio: 'inherit' });
if (migrate.status !== 0) process.exit(migrate.status ?? 1);
const server = spawn(process.execPath, [wrangler, 'dev', '--local', '--port', '8788', '--config', configPath, '--persist-to', state], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
server.on('exit', code => process.exit(code ?? 0));
