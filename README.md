# Relay

A private Instagram automation workspace for accounts you own and manage. Build comment-to-DM campaigns, edit branching flows, store conversations and leads, and attribute resource-link clicks to campaigns.

The application uses TypeScript, React, Cloudflare Workers, D1, and Queues.

## Run locally

Use a current Node.js release supported by the installed Wrangler and Vite versions.

```sh
npm ci
npm run setup:local
npm run db:migrate
npm run dev:api
```

Open `http://127.0.0.1:8787` and sign in using `ADMIN_PASSWORD` from `.dev.vars`. Local setup creates random credentials and preserves an existing configuration. The file is ignored by Git.

Wrangler runs a local Worker and local D1 storage. These commands do not create a hosted database or use a Cloudflare account. Data remains under `.wrangler` in this checkout.

For frontend hot reload, run `npm run dev` in another terminal and open the printed Vite URL. Vite proxies API requests to the local Worker.

Use the demo setup control to add simulated accounts and content, then create and publish a campaign. The developer tools submit comments and responses through the backend without contacting Instagram. Simulated messages are not real Instagram deliveries.

## Connect Instagram

The local demo does not require a Meta developer account. Live integration requires a custom Meta app and authorization for each managed Instagram professional account.

Configure the app for the Instagram Login integration used by this implementation. Required scopes are `instagram_business_basic`, `instagram_business_manage_comments`, and `instagram_business_manage_messages`. Insights access needs verification for the selected setup before enabling it. Do not mix permissions from different API setups.

Register the application's HTTPS callback and webhook URLs in Meta's dashboard. Settings shows the URLs derived from `PUBLIC_BASE_URL`:

- `/auth/instagram/callback` completes account authorization.
- `/webhooks/instagram` verifies subscriptions and receives signed events.

Meta needs a public HTTPS endpoint for live webhooks. Use the finished pilot deployment or an explicitly configured development tunnel for that step.

Set `META_APP_ID`, `META_APP_SECRET`, and `META_WEBHOOK_VERIFY_TOKEN` for the custom app. Keep tokens and secrets out of source control. Use the account connection control to authorize access. The server encrypts stored account tokens with `TOKEN_ENCRYPTION_KEY`.

Verify comments and messaging with an actual person outside the app's developer roles and complete any required review. Test the initial private reply, response-button events, subsequent messages, media access, and insights. Own-account use does not establish all required permissions.

Keep ManyChat connected during investigation. Before enabling overlapping production automations, pause the corresponding ManyChat campaign and verify Meta's conversation-routing configuration. Cut over one account at a time.

## Deploy to your Cloudflare account

Local development and the end-to-end suite do not create hosted resources. Deployment requires separate owner setup.

1. Authenticate Wrangler to the intended Cloudflare account. Confirm the account before creating resources.
2. Confirm the account and database IDs in `wrangler.jsonc`. When deploying to another account, create D1 and replace those IDs.
3. Create the queue and dead-letter queue named in `wrangler.jsonc` only if they do not already exist.
4. Set `PUBLIC_BASE_URL` to the deployment's HTTPS origin and disable `DEMO_MODE`.
5. Set new production values for `ADMIN_PASSWORD`, `SESSION_SECRET`, and `TOKEN_ENCRYPTION_KEY`, plus Meta app credentials and the verification token. Preserve the encryption key during redeployments.
6. For the first deployment, set `workers_dev` and `preview_urls` to `false`. Apply remote migrations, build, and deploy.
7. Configure Cloudflare Access before enabling the public hostname, as described below.
8. Set `workers_dev` to `true`, keep `preview_urls` disabled, and deploy again. Verify anonymous requests are redirected to Access and the owner can sign in.
9. Configure Meta's callback and webhook subscription, then authorize the pilot account.
10. Verify the live pilot before migrating other accounts.

Example commands, to run only after selecting your account and matching the resource names to the checked-in configuration:

```sh
npx wrangler login
npx wrangler d1 create comment-on-video
npx wrangler queues create comment-on-video-outbox
npx wrangler queues create comment-on-video-dead-letter
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_KEY
npx wrangler secret put META_APP_ID
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_WEBHOOK_VERIFY_TOKEN
npx wrangler d1 migrations apply DB --remote
npm run deploy
```

Authentication, remote resource creation, secrets, migration, and deployment are not performed automatically.

### Restrict dashboard access

In Cloudflare Zero Trust, create a self-hosted Access application covering the entire deployment hostname. Use an Allow policy with the owner's exact email. Do not use an email-domain rule for a personal Gmail address.

Create a second Access application with only these two destinations on the same hostname:

- `/webhooks/instagram`
- `/r/*`

Give that application a Bypass policy including Everyone. These paths serve Meta's webhook and resource recipients. The webhook still checks the configured verification token and request signatures. The dashboard, assets, `/api/*`, and `/auth/*` remain protected by the broader application. The Instagram OAuth callback stays behind Access because it is an owner browser redirect.

[Cloudflare applies the most specific path policy](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/). Protect every hostname that serves the dashboard. Keep preview URLs disabled. If adding a custom domain, configure Access for it before routing traffic there.

Cloudflare Access checks identity first. The application then requires its separate `ADMIN_PASSWORD`. Production credentials are saved locally in the ignored `.dev.vars.production.json` with owner-only file permissions and stored remotely as Worker secrets. Preserve the token encryption key when redeploying.

After deployment, run `npm run test:hosted` to check anonymous dashboard and API protection, public recipient-link routing, and webhook rejection. If the local production secret file or `META_WEBHOOK_VERIFY_TOKEN` is available, it also verifies Meta's subscription challenge. The checks do not send Instagram messages or change campaigns. Owner sign-in and real Instagram delivery need separate verification.

## Operational behavior

Drafts and immutable publications are separate. Existing runs use their original flow version. Each account has its own contacts, campaigns, media bindings, credentials, and sending allowance.

The webhook receiver checks signatures over the original request body and stores events with recoverable work records. Storage deduplicates events and action claims. Unknown external send outcomes remain visible as uncertain instead of being automatically repeated.

Message eligibility is checked when sending. Initial private replies and continuing DMs have different rules. An external website visit does not open the Instagram messaging window.

Resource buttons use saved, opaque tracking URLs. The redirect records a visit and forwards the recipient to the destination, such as Notion. Link previews can create automated visits. Forwarded links remain attributed to the original message rather than a verified visitor identity.

Confirmed deletion removes the selected stored data and dependent records. Minimal hashes of processed event identifiers remain to prevent old webhook retries from recreating deleted conversations or sending the same replies again. These receipts contain no message payloads, usernames, account credentials, or original event identifiers.

Records are retained until the owner deletes them. Dashboard record lists have bounds and show a configuration warning when those limits are reached. The JSON export includes all matching records, published versions, and attribution history without dashboard row caps, while excluding credentials and internal authentication state.

Dashboard sends mean API-accepted messages unless another delivery status is available. Content engagement and automation response rates have separate denominators. Missing insights remain unavailable.
