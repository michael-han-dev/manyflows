# Manyflows

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

## Testing

This repository strictly uses end-to-end (E2E) testing. Do not add unit tests or unit-test frameworks. Add regression coverage to the Playwright suite in `tests/e2e/`.

Run `npm run test:e2e` to build the frontend and run the suite against a local Worker with isolated D1 storage. The suite simulates Meta API responses and does not require live Instagram credentials. Run `npm run check` for TypeScript validation.

## Connect Instagram

The local demo does not require a Meta developer account. Live integration requires a custom Meta app and authorization for each managed Instagram professional account.

Configure the Instagram API with Unified Login. Create or select an Instagram-compatible Facebook Login for Business configuration with system-user access tokens, require an Instagram account, and request only `instagram_basic`, `instagram_manage_comments`, and `instagram_manage_messages`. Add `instagram_manage_insights` only if insights are needed and `META_INSIGHTS_ENABLED` is enabled. The login configuration controls permissions and token expiration. Ads, content publishing, and business-management permissions are not needed for the comment-to-resource pilot.

Register the application's HTTPS callback and webhook URLs in Meta's dashboard. Settings shows the URLs derived from `PUBLIC_BASE_URL`:

- `/auth/instagram/callback` completes account authorization.
- `/webhooks/instagram` verifies subscriptions and receives signed events.

Meta needs a public HTTPS endpoint for live webhooks. Use the finished pilot deployment or an explicitly configured development tunnel for that step.

Set `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, and `META_WEBHOOK_VERIFY_TOKEN` for the custom Meta app. Keep credentials and deployment details out of source control. Subscribe the app webhook to `comments`, `messages`, and `messaging_postbacks`. Use Connect Instagram to open Meta Unified Login, select the business portfolio, and share the professional Instagram accounts you manage. The server discovers every shared account before saving the connection and subscribes each account to webhooks.

All selected accounts in a business share one grant encrypted with `TOKEN_ENCRYPTION_KEY`. Their contacts and campaigns remain separate. Reconnecting replaces that grant and detaches accounts omitted from the new selection without deleting their data. A failed webhook subscription restricts that account; a media sync failure leaves its connection status unchanged and shows a warning. Token expiry or revocation requires reconnecting through Unified Login. This implementation does not refresh tokens automatically or use the legacy Instagram Login endpoints. Migration `0005_unified_login.sql` preserves demo data and asks any old live accounts to reconnect.

Development mode supports testing with accounts that have a role on the Meta app. Before connecting other clients, complete the required App Review and request Advanced Access for the configuration permissions. Verify comments and messaging with an actual person and the access level needed for your pilot. Test the initial private reply, response-button events, subsequent messages, media access, and insights. Own-account use does not establish all required permissions.

Keep ManyChat connected during investigation. Before enabling overlapping production automations, pause the corresponding ManyChat campaign and verify Meta's conversation-routing configuration. Cut over one account at a time.

## Deploy to your Cloudflare account

Local development and the end-to-end suite do not create hosted resources. Deployment requires separate owner setup.

The checked-in `wrangler.jsonc` contains placeholder hosting values. Copy it to the ignored `wrangler.production.jsonc` for production, and keep your account ID, database ID, and deployment URL in that local file.

1. Authenticate Wrangler to the intended Cloudflare account. Confirm the account before creating resources.
2. Set the account and database IDs in `wrangler.production.jsonc`. Create D1 if needed.
3. Create the queue and dead-letter queue named in `wrangler.production.jsonc` only if they do not already exist.
4. Set `PUBLIC_BASE_URL` to the deployment's HTTPS origin and disable `DEMO_MODE`.
5. Set new production values for `ADMIN_PASSWORD`, `SESSION_SECRET`, and `TOKEN_ENCRYPTION_KEY`, plus Meta app credentials and the verification token. Preserve the encryption key during redeployments.
6. For the first deployment, set `workers_dev` and `preview_urls` to `false`. Apply remote migrations, build, and deploy.
7. Configure Cloudflare Access before enabling the public hostname, as described below.
8. Set `workers_dev` to `true`, keep `preview_urls` disabled, and deploy again. Verify anonymous requests are redirected to Access and the owner can sign in.
9. Configure Meta's callback and webhook subscription, then authorize the pilot account.
10. Verify the live pilot before migrating other accounts.

Example commands, to run only after selecting your account and matching the resource names to your production configuration:

```sh
npx wrangler login
npx wrangler d1 create comment-on-video
npx wrangler queues create comment-on-video-outbox
npx wrangler queues create comment-on-video-dead-letter
npx wrangler secret put ADMIN_PASSWORD --config wrangler.production.jsonc
npx wrangler secret put SESSION_SECRET --config wrangler.production.jsonc
npx wrangler secret put TOKEN_ENCRYPTION_KEY --config wrangler.production.jsonc
npx wrangler secret put META_APP_ID --config wrangler.production.jsonc
npx wrangler secret put META_APP_SECRET --config wrangler.production.jsonc
npx wrangler secret put META_LOGIN_CONFIG_ID --config wrangler.production.jsonc
npx wrangler secret put META_WEBHOOK_VERIFY_TOKEN --config wrangler.production.jsonc
npx wrangler d1 migrations apply DB --remote --config wrangler.production.jsonc
npm run build
npx wrangler deploy --config wrangler.production.jsonc
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

After deployment, run `npm run test:hosted -- wrangler.production.jsonc` to check anonymous dashboard and API protection, public recipient-link routing, and webhook rejection. If the local production secret file or `META_WEBHOOK_VERIFY_TOKEN` is available, it also verifies Meta's subscription challenge. The checks do not send Instagram messages or change campaigns. Owner sign-in and real Instagram delivery need separate verification.

## Operational behavior

Drafts and immutable publications are separate. Existing runs use their original flow version. Each account has its own contacts, campaigns, media bindings, and sending allowance. Accounts selected from the same business share an encrypted Meta grant. Deleting one account preserves the grant while another account still uses it; deleting its last account removes the stored grant.

The webhook receiver checks signatures over the original request body and stores events with recoverable work records. Storage deduplicates events and action claims. Unknown external send outcomes remain visible as uncertain instead of being automatically repeated.

Message eligibility is checked when sending. Initial private replies and continuing DMs have different rules. An external website visit does not open the Instagram messaging window.

Resource buttons use saved, opaque tracking URLs. The redirect records a visit and forwards the recipient to the destination, such as Notion. Link previews can create automated visits. Forwarded links remain attributed to the original message rather than a verified visitor identity.

Confirmed deletion removes the selected stored data and dependent records. Minimal hashes of processed event identifiers remain to prevent old webhook retries from recreating deleted conversations or sending the same replies again. These receipts contain no message payloads, usernames, account credentials, or original event identifiers.

Records are retained until the owner deletes them. Dashboard record lists have bounds and show a configuration warning when those limits are reached. The JSON export includes all matching records, published versions, and attribution history without dashboard row caps, while excluding credentials and internal authentication state.

Dashboard sends mean API-accepted messages unless another delivery status is available. Content engagement and automation response rates have separate denominators. Missing insights remain unavailable.
