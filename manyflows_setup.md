# Manyflows setup and deployment guide

Manyflows is a private Instagram automation workspace for accounts you own or manage. It recreates comment-to-DM campaigns using official Meta APIs, with your own dashboard and database.

## Deploy changes to the existing site

Run these commands from this repository after saving your changes:

```sh
npm run check
npm run build
npx wrangler deploy --config wrangler.production.jsonc
node scripts/verify-hosted.mjs wrangler.production.jsonc
```

The build compiles the frontend. Wrangler uploads the frontend assets and backend Worker, then makes the new version live. The final command checks hosted access restrictions and webhook routing. Run `npm run test:e2e` before deploying behavior changes.

If Wrangler authentication has expired, run `npx wrangler login` first. Use `npx wrangler whoami` to confirm the account. Always specify the private production config; the tracked `wrangler.jsonc` contains placeholders.

Only when adding database migrations, apply them before deploying:

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc
```

Normal code deployments reuse the existing database, queues, secrets, and Access policies. Committing or pushing to GitHub saves source changes; our deployment process has used Wrangler separately.

### Where to look in Cloudflare

Open the [Cloudflare dashboard](https://dash.cloudflare.com/), choose your account, then **Workers & Pages → comment-on-video**. The product is called Manyflows; the underlying Worker retains its original name.

- **Deployments** shows active and previous versions, deployment history, and rollback controls.
- **Settings** contains domains, bindings, variables, and secrets. **Settings → Builds** is where Git-based automatic deployment can be configured.
- **D1** in the account sidebar contains the database. **Queues** contains background jobs. **Zero Trust → Access → Applications** contains the owner-only login rules.

Use the terminal deployment commands for this project. If configuring automatic builds later, account for the ignored production configuration and credentials. Rolling back Worker code does not roll back database changes.

## Architecture and features

Use TypeScript throughout, React for the interface, Cloudflare Workers for the API, D1 for SQL storage, Queues for jobs, and scheduled work for recovery and delays. No permanently running server or AI agent is needed. Saved flow rules and database state drive the automation.

Implement account isolation, campaign drafts and published versions, post targeting, keyword matching, optional public reply variations, opening DMs, response buttons, resource links, branches, email collection, tags, and delays. The dashboard includes content, conversations, contacts, activity, metrics, and exports.

Store accounts and encrypted Meta grants, media, campaigns, contacts, messages, conversation runs, incoming events, queued actions, responses, and tracked clicks. For a fresh implementation, build authentication and storage first, then webhook intake and jobs, then flow execution and Meta sending, then the dashboard. Add demo mode early and verify each stage end to end.

An Instagram comment reaches the signed webhook. The Worker verifies and deduplicates it, stores it, and queues processing. The engine matches the account, reel, and keywords, then sends the configured replies. A response-button postback advances the conversation. A resource button opens an opaque `/r/…` URL that records a visit and redirects to a destination such as Notion.

Check messaging eligibility at send time. Website visits do not open messaging windows. Surface uncertain send outcomes instead of blindly resending. Distinguish API-accepted messages from confirmed delivery, and button response rates from Instagram reach and engagement. Forwarded links and link previews can affect attribution.

## Run locally

Install Git, a supported current Node.js release, and npm. Clone the [repository](https://github.com/michael-han-dev/manyflows), then run:

```sh
npm ci
npm run setup:local
npm run db:migrate
npm run dev:api
```

Open `http://127.0.0.1:8787`. Find `ADMIN_PASSWORD` in the generated, ignored `.dev.vars`. This uses local D1 and does not create a hosted database. Seed demo accounts to test flows without sending Instagram messages.

`src/client` owns the interface, `src/server` owns authentication and processing, `src/shared` owns flow definitions, and `migrations` owns the database schema. For frontend hot reload, also run `npm run dev`.

## First deployment on your own Cloudflare account

Create a Cloudflare account and sign up for Zero Trust. Check current Workers, D1, and Queues allowances before enabling a paid plan; hosting is separate from ManyChat subscription costs.

```sh
npx wrangler login
npx wrangler whoami
cp wrangler.jsonc wrangler.production.jsonc
npx wrangler d1 create comment-on-video
npx wrangler queues create comment-on-video-outbox
npx wrangler queues create comment-on-video-dead-letter
```

In the ignored production config, enter your account ID, returned database ID, matching queue names, and HTTPS `PUBLIC_BASE_URL`. Set `DEMO_MODE=false`. Initially set `workers_dev=false` and `preview_urls=false`.

Store each value using `npx wrangler secret put NAME --config wrangler.production.jsonc`:

- Generate `ADMIN_PASSWORD`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, and `META_WEBHOOK_VERIFY_TOKEN`. Use independent random values. The session secret needs at least 32 characters; the encryption key is 32 random bytes encoded as base64.
- Copy `META_APP_ID`, `META_APP_SECRET`, and `META_LOGIN_CONFIG_ID` from Meta after configuring the app below.

Apply remote migrations, build, and deploy using the commands at the start of this guide. Preserve the encryption key across deployments.

### Keep the site private

In Cloudflare Access, create a self-hosted application protecting the entire deployment hostname. Allow only your exact email address. Create another application covering only `/webhooks/instagram` and `/r/*`, with an Everyone Bypass policy. Meta needs the webhook and resource recipients need redirects. Keep the dashboard, API, assets, and OAuth callback protected.

After Access is configured, enable `workers_dev` and deploy again. Keep preview URLs disabled. Protect any custom domain before using it. Sign in through Cloudflare identity verification, then enter the separate Manyflows `ADMIN_PASSWORD`.

## Configure Meta and connect Instagram

1. Create a Meta developer app owned by your business portfolio. Add **Manage messaging & content on Instagram** and open **API setup with Unified login**. Use a professional Creator or Business Instagram account.
2. Create an Instagram-compatible Facebook Login for Business configuration. This setup used **General**, **System-user token**, **Instagram accounts required**, and **Never** expiration. Request `instagram_basic`, `instagram_manage_comments`, and `instagram_manage_messages`. Add insights permissions only if needed.
3. Save `https://YOUR_HOST/auth/instagram/callback` as the OAuth redirect. Configure `https://YOUR_HOST/webhooks/instagram` with the matching verify token. Subscribe to `comments`, `messages`, and `messaging_postbacks`.
4. For development-mode Instagram login, invite the account as an **Instagram Tester**. Accept on Instagram web under **Settings → Website permissions → Apps and websites → Tester Invites**.
5. Save the Meta app credentials and configuration ID as Worker secrets. In Manyflows, open **Settings → Connect Instagram**, select the business portfolio and Instagram assets, and approve access. Sync the connected account.

Standard Access supports app-role testing. Connecting clients without app roles requires appropriate Advanced Access and Live mode. Confirm eligibility for the intended audience before cutover. Use the current Unified Login instructions rather than older Instagram-only authentication guides.

## Recreate and test a ManyChat campaign

1. Keep ManyChat connected. Manually recreate one simple flow in Manyflows.
2. Target an existing reel and use a unique temporary keyword such as `FLOWTEST47`, different from its recorded CTA. Configure optional public replies, the opening DM, a response button, and the final resource link.
3. From another eligible Instagram account, comment the test keyword. Verify the replies, button event, resource DM, redirect, stored contact, and dashboard results. Check for duplicates and failures.
4. After the complete journey passes and access supports the audience, pause the matching ManyChat automation and switch Manyflows to the original keyword. Keep the existing reel and recorded CTA. Verify conversation routing between the apps.
5. To roll back, pause Manyflows before restoring the ManyChat automation.

## Verification and maintenance

```sh
npm run check
npx playwright install chromium
npm run test:e2e
```

Prefer end-to-end tests for account isolation, publishing, conversations, redirects, retries, exports, and mobile layouts. Demo tests do not establish live Instagram delivery; hosted checks do not establish owner sign-in or messaging.

Ignore credentials, private production config, `.wrangler`, build output, dependencies, test reports, `implement.md`, and `the_plan.md`. Commit sanitized examples only. `.gitignore` does not erase history: rotate exposed credentials and scrub affected history when necessary. Back up D1 and preserve encryption keys. Reconnect accounts if Meta access expires or is revoked.

## Current handoff

As of 16 November 2026, the app is deployed with owner-only access and the Meta login configuration and webhooks configured. Live Instagram authorization and delivery remain unverified. Instagram login returned **App not active**; the app is unpublished and its Instagram Tester list is empty. Missing tester registration is the leading explanation, pending a successful retry. Invite and accept the intended tester account, reconnect, then run the pilot.

## References

- [Cloudflare deployments and rollback](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Cloudflare automatic build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Cloudflare Access path precedence](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)
- [Meta Unified Login setup](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started)
- [Meta eligibility and troubleshooting](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/eligibility-and-troubleshooting)
