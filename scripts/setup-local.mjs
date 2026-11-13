import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

if (existsSync('.dev.vars')) {
  process.stdout.write('Existing .dev.vars preserved. Local setup did not replace your credentials.\n');
} else {
  const values = {
    ADMIN_PASSWORD: randomBytes(18).toString('base64url'),
    SESSION_SECRET: randomBytes(48).toString('base64url'),
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    META_APP_SECRET: 'local-demo-meta-secret',
    META_WEBHOOK_VERIFY_TOKEN: randomBytes(24).toString('base64url'),
    DEMO_MODE: 'true',
    PUBLIC_BASE_URL: 'http://127.0.0.1:8787',
    GRAPH_VERSION: 'v27.0',
  };
  writeFileSync('.dev.vars', Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n') + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write('Created local-only configuration in .dev.vars. Open it to find ADMIN_PASSWORD. No Cloudflare account or hosted database was accessed.\n');
}
