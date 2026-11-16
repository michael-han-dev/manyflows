import { Hono } from 'hono';
import { z } from 'zod';
import { campaignInputSchema, validateFlow, type Bootstrap, type Click, type Message, type ProcessingJob } from '../shared/domain';
import { ApiError, accountSelect, account, action, baseUrl, buttons, campaign, campaignSelect, contact, demoAllowed, flowRun, graphVersion, media, metaConfigured, now, one, requireValue, rows, run, statement, uid, type AccountRow, type ActionRow, type AppEnv, type CampaignRow, type PublishedCampaignRow, type ContactRow, type Env, type MediaRow, type RunRow } from './core';
import { syncAccount } from './meta';
import { dispatch, eventSchema } from './events';
import { deleteStoredData } from './deletion';

interface JobRow { id: string; account_id: string; kind: ProcessingJob['kind']; state: ProcessingJob['state']; attempts: number; error: string | null; available_at: number; received_at: number; }
interface MessageRow { id: string; account_id: string; contact_id: string; run_id: string | null; direction: Message['direction']; channel: Message['channel']; text: string; buttons: string; status: Message['status']; created_at: number; }
interface ClickRow { id: string; account_id: string; campaign_id: string; run_id: string; contact_id: string; link_id: string; automated: number; created_at: number; }
const date = (value: string | undefined, fallback: number) => { if (!value) return fallback; const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value); if (!Number.isFinite(parsed)) throw new ApiError(400, 'Invalid date range.'); return parsed; };
export async function bootstrap(env: Env, query: { accountId?: string; from?: string; to?: string } = {}, mode: 'dashboard' | 'export' = 'dashboard'): Promise<Bootstrap> {
  const accountId = query.accountId && query.accountId !== 'all' ? query.accountId : null;
  const from = date(query.from, 0), to = date(query.to, 9007199254740991);
  if (from > to) throw new ApiError(400, 'Start date must be before end date.');
  const accountWhere = '(? IS NULL OR account_id=?)';
  const rangeWhere = `${accountWhere} AND created_at>=? AND created_at<=?`;
  const limit = (size: number) => mode === 'dashboard' ? `LIMIT ${size}` : '';
  const [accounts, medias, campaigns, contacts, runs, actions, messages, clicks, responses, emails, jobs] = await Promise.all([
    rows<AccountRow>(env, `${accountSelect} ORDER BY mode,username`),
    rows<MediaRow>(env, `SELECT * FROM media WHERE ${accountWhere} ORDER BY published_at DESC ${limit(1000)}`, accountId, accountId),
    rows<PublishedCampaignRow>(env, `${campaignSelect} WHERE (? IS NULL OR campaigns.account_id=?) ORDER BY campaigns.created_at DESC`, accountId, accountId),
    rows<ContactRow>(env, `SELECT * FROM contacts WHERE ${accountWhere} ORDER BY created_at DESC ${limit(5000)}`, accountId, accountId),
    rows<RunRow>(env, `SELECT * FROM runs WHERE ${rangeWhere} ORDER BY created_at DESC ${limit(5000)}`, accountId, accountId, from, to),
    rows<ActionRow>(env, `SELECT * FROM actions WHERE ${rangeWhere} ORDER BY created_at DESC ${limit(10000)}`, accountId, accountId, from, to),
    rows<MessageRow>(env, `SELECT * FROM messages WHERE ${rangeWhere} ORDER BY created_at ASC ${limit(10000)}`, accountId, accountId, from, to),
    rows<ClickRow>(env, `SELECT * FROM clicks WHERE ${rangeWhere} ORDER BY created_at DESC ${limit(10000)}`, accountId, accountId, from, to),
    rows<{ contact_id: string }>(env, `SELECT DISTINCT contact_id FROM responses WHERE ${rangeWhere}`, accountId, accountId, from, to),
    rows<{ contact_id: string }>(env, `SELECT DISTINCT contact_id FROM email_captures WHERE ${rangeWhere}`, accountId, accountId, from, to),
    rows<JobRow>(env, `SELECT outbox.id,events.account_id,json_extract(events.payload,'$.kind') AS kind,outbox.state,outbox.attempts,outbox.error,outbox.available_at,events.received_at FROM outbox JOIN events ON events.id=outbox.event_id WHERE outbox.state!='done' AND (? IS NULL OR events.account_id=?) ORDER BY events.received_at DESC ${limit(1000)}`, accountId, accountId),
  ]);
  const accepted = actions.filter(item => item.status === 'succeeded');
  const warnings = accounts.flatMap(account => account.sync_error ? [`@${account.username}: ${account.sync_error}`] : []);
  if (!metaConfigured(env)) warnings.push('Meta is not configured. Local simulations do not prove live Instagram access.');
  if (env.META_INSIGHTS_ENABLED !== 'true') warnings.push('Instagram insights are disabled. Unavailable content metrics are shown as unknown.');
  if (mode === 'dashboard' && (medias.length === 1000 || contacts.length === 5000 || runs.length === 5000 || messages.length === 10000 || actions.length === 10000 || clicks.length === 10000 || jobs.length === 1000)) warnings.push('This view reached its record limit. Select a narrower date range or export all records.');
  return {
    accounts: accounts.map(account), media: medias.map(media), campaigns: campaigns.map(campaign), contacts: contacts.map(contact), runs: runs.map(flowRun), actions: actions.map(action),
    messages: messages.map(item => ({ id: item.id, accountId: item.account_id, contactId: item.contact_id, runId: item.run_id, direction: item.direction, channel: item.channel, text: item.text, buttons: buttons.parse(JSON.parse(item.buttons)), status: item.status, createdAt: item.created_at })),
    clicks: clicks.map((item): Click => ({ id: item.id, accountId: item.account_id, campaignId: item.campaign_id, runId: item.run_id, contactId: item.contact_id, linkId: item.link_id, automated: !!item.automated, createdAt: item.created_at })),
    jobs: jobs.map(item => ({ id: item.id, accountId: item.account_id, kind: item.kind, state: item.state, attempts: item.attempts, error: item.error, availableAt: item.available_at, receivedAt: item.received_at })),
    metrics: { matchedComments: runs.length, openingAccepted: accepted.filter(item => item.kind === 'private').length, linkMessagesAccepted: accepted.filter(item => buttons.parse(JSON.parse(item.buttons)).some(button => button.kind === 'url')).length, buttonResponders: responses.length, uniqueClickers: new Set(clicks.filter(click => !click.automated).map(click => click.contact_id)).size, emailsCollected: emails.length, completedRuns: runs.filter(item => item.state === 'complete').length, failedActions: actions.filter(item => item.status === 'failed' || item.status === 'uncertain').length },
    configuration: { demoEnabled: demoAllowed(env), metaConfigured: metaConfigured(env), publicBaseUrl: baseUrl(env), webhookUrl: `${baseUrl(env)}/webhooks/instagram`, callbackUrl: `${baseUrl(env)}/auth/instagram/callback`, graphVersion: graphVersion(env), warnings },
  };
}
export const api = new Hono<AppEnv>();
api.get('/api/bootstrap', async c => c.json(await bootstrap(c.env, c.req.query())));
api.get('/api/export', async c => {
  const query = c.req.query();
  const data = await bootstrap(c.env, query, 'export');
  const accountId = query.accountId && query.accountId !== 'all' ? query.accountId : null;
  const [versions, links, responses, emailCaptures, snapshots] = await Promise.all([
    rows<{ id: string; campaignId: string; input: string; createdAt: number }>(c.env, 'SELECT versions.id,versions.campaign_id AS campaignId,versions.input,versions.created_at AS createdAt FROM versions JOIN campaigns ON campaigns.id=versions.campaign_id WHERE (? IS NULL OR campaigns.account_id=?) ORDER BY versions.created_at', accountId, accountId),
    rows(c.env, 'SELECT token,account_id AS accountId,campaign_id AS campaignId,run_id AS runId,contact_id AS contactId,action_id AS actionId,destination,choice FROM links WHERE (? IS NULL OR account_id=?)', accountId, accountId),
    rows(c.env, 'SELECT event_id AS eventId,account_id AS accountId,contact_id AS contactId,run_id AS runId,created_at AS createdAt FROM responses WHERE (? IS NULL OR account_id=?) ORDER BY created_at', accountId, accountId),
    rows(c.env, 'SELECT event_id AS eventId,account_id AS accountId,contact_id AS contactId,created_at AS createdAt FROM email_captures WHERE (? IS NULL OR account_id=?) ORDER BY created_at', accountId, accountId),
    rows<{ id: string; accountId: string; mediaId: string; metrics: string; collectedAt: number }>(c.env, 'SELECT id,account_id AS accountId,media_id AS mediaId,metrics,collected_at AS collectedAt FROM metric_snapshots WHERE (? IS NULL OR account_id=?) ORDER BY collected_at', accountId, accountId),
  ]);
  c.header('Content-Disposition', 'attachment; filename="instagram-automation-export.json"');
  return c.json({ exportedAt: await now(c.env), ...data, versions: versions.map(version => ({ ...version, input: campaignInputSchema.parse(JSON.parse(version.input)) })), links, responses, emailCaptures, metricSnapshots: snapshots.map(snapshot => ({ ...snapshot, metrics: z.record(z.string(), z.number().nullable()).parse(JSON.parse(snapshot.metrics)) })) });
});
api.post('/api/campaigns', async c => {
  const input = campaignInputSchema.parse(await c.req.json());
  requireValue(await one(c.env, `${accountSelect} WHERE id=?`, input.accountId), 'Account not found.');
  const id = uid(), time = await now(c.env);
  await run(c.env, 'INSERT INTO campaigns(id,account_id,name,draft,created_at,updated_at) VALUES(?,?,?,?,?,?)', id, input.accountId, input.name, JSON.stringify(input), time, time);
  return c.json(campaign(requireValue(await one<PublishedCampaignRow>(c.env, `${campaignSelect} WHERE campaigns.id=?`, id))), 201);
});
api.put('/api/campaigns/:id', async c => {
  const input = campaignInputSchema.parse(await c.req.json());
  const existing = requireValue(await one<CampaignRow>(c.env, 'SELECT * FROM campaigns WHERE id=?', c.req.param('id')));
  if (existing.account_id !== input.accountId) throw new ApiError(400, 'Duplicate the campaign to move it to another account.');
  await run(c.env, 'UPDATE campaigns SET name=?,draft=?,updated_at=? WHERE id=?', input.name, JSON.stringify(input), await now(c.env), existing.id);
  return c.json(campaign(requireValue(await one<PublishedCampaignRow>(c.env, `${campaignSelect} WHERE campaigns.id=?`, existing.id))));
});
api.post('/api/campaigns/:id/publish', async c => {
  const existing = requireValue(await one<CampaignRow>(c.env, 'SELECT * FROM campaigns WHERE id=?', c.req.param('id')));
  const input = campaignInputSchema.parse(JSON.parse(existing.draft));
  const errors = validateFlow(input);
  if (input.target.kind === 'specific' && !await one(c.env, 'SELECT id FROM media WHERE account_id=? AND id=?', input.accountId, input.target.mediaId)) errors.push('The selected media does not belong to this account.');
  const account = requireValue(await one<AccountRow>(c.env, `${accountSelect} WHERE id=?`, input.accountId));
  if (account.status !== 'connected') errors.push('Reconnect this account before publishing.');
  if (input.target.kind === 'next') {
    const pending = await one(c.env, "SELECT id FROM campaigns WHERE account_id=? AND id!=? AND status='live' AND bound_media_id IS NULL AND live_target_kind='next'", input.accountId, existing.id);
    if (pending) errors.push('Only one pending next-publication campaign is allowed per account.');
  }
  if (errors.length) throw new ApiError(400, 'This campaign cannot be published yet.', errors);
  const versionId = uid();
  if (input.target.kind === 'next' && account.mode === 'live') await syncAccount(c.env, account);
  const time = await now(c.env);
  const baseline = (await rows<{ id: string }>(c.env, 'SELECT id FROM media WHERE account_id=?', input.accountId)).map(item => item.id);
  const prior = existing.live_version_id ? await one<{ input: string }>(c.env, 'SELECT input FROM versions WHERE id=?', existing.live_version_id) : null;
  const retainBinding = prior && campaignInputSchema.parse(JSON.parse(prior.input)).target.kind === 'next' && input.target.kind === 'next';
  await c.env.DB.batch([statement(c.env, 'INSERT INTO versions(id,campaign_id,input,created_at) VALUES(?,?,?,?)', versionId, existing.id, existing.draft, time), statement(c.env, "UPDATE campaigns SET status='live',live_target_kind=?,live_version_id=?,armed_at=?,baseline=?,bound_media_id=?,updated_at=? WHERE id=?", input.target.kind, versionId, retainBinding ? existing.armed_at : time, retainBinding ? existing.baseline : JSON.stringify(baseline), input.target.kind === 'specific' ? input.target.mediaId : retainBinding ? existing.bound_media_id : null, time, existing.id)]);
  return c.json(campaign(requireValue(await one<PublishedCampaignRow>(c.env, `${campaignSelect} WHERE campaigns.id=?`, existing.id))));
});
api.post('/api/campaigns/:id/pause', async c => { requireValue(await one(c.env, 'SELECT id FROM campaigns WHERE id=?', c.req.param('id'))); await run(c.env, "UPDATE campaigns SET status='paused',updated_at=? WHERE id=?", await now(c.env), c.req.param('id')); return c.json(campaign(requireValue(await one<PublishedCampaignRow>(c.env, `${campaignSelect} WHERE campaigns.id=?`, c.req.param('id'))))); });
api.post('/api/campaigns/:id/duplicate', async c => {
  const existing = requireValue(await one<CampaignRow>(c.env, 'SELECT * FROM campaigns WHERE id=?', c.req.param('id')));
  const body = z.object({ accountId: z.string().optional() }).parse(await c.req.json().catch(() => ({})));
  const input = campaignInputSchema.parse(JSON.parse(existing.draft));
  const accountId = body.accountId ?? existing.account_id;
  requireValue(await one(c.env, `${accountSelect} WHERE id=?`, accountId));
  const copy = { ...input, accountId, name: `${input.name.slice(0, 113)} (copy)`, ...(accountId !== existing.account_id ? { target: { kind: 'all' as const } } : {}) };
  const id = uid(), time = await now(c.env);
  await run(c.env, 'INSERT INTO campaigns(id,account_id,name,draft,created_at,updated_at) VALUES(?,?,?,?,?,?)', id, accountId, copy.name, JSON.stringify(copy), time, time);
  return c.json(campaign(requireValue(await one<PublishedCampaignRow>(c.env, `${campaignSelect} WHERE campaigns.id=?`, id))), 201);
});
api.post('/api/accounts/:id/sync', async c => { const account = requireValue(await one<AccountRow>(c.env, `${accountSelect} WHERE id=?`, c.req.param('id'))); await syncAccount(c.env, account); return c.json({ ok: true }); });

api.post('/api/jobs/:id/retry', async c => {
  const id = c.req.param('id');
  const record = requireValue(await one<{ payload: string; applied_at: number | null }>(c.env, 'SELECT events.payload,events.applied_at FROM outbox JOIN events ON events.id=outbox.event_id WHERE outbox.id=?', id), 'Processing job not found.');
  if (record.applied_at !== null) throw new ApiError(409, 'This event was already applied. Review its conversation and send outcomes.');
  const event = eventSchema.parse(JSON.parse(record.payload));
  const time = await now(c.env);
  const reset = await statement(c.env, `UPDATE outbox SET state='pending',attempts=0,error=NULL,available_at=?,lease_until=NULL
    WHERE id=? AND state IN ('pending','queued','processing','failed') AND COALESCE(lease_until,0)<=?
    AND EXISTS(SELECT 1 FROM events WHERE events.id=outbox.event_id AND applied_at IS NULL)
    AND NOT EXISTS(SELECT 1 FROM runs JOIN contacts ON contacts.id=runs.contact_id WHERE contacts.account_id=? AND contacts.instagram_id=? AND (runs.lock_until>? OR EXISTS(SELECT 1 FROM actions WHERE actions.run_id=runs.id AND actions.status IN ('executing','uncertain'))))
    RETURNING id`, time, id, time, event.accountId, event.senderId, Date.now()).first();
  if (!reset) throw new ApiError(409, 'This job has an active lease or an uncertain send, or was already applied. Wait for active work to finish and review send outcomes before retrying.');
  c.executionCtx.waitUntil(dispatch(c.env));
  return c.json({ ok: true });
});

api.delete('/api/contacts/:id', async c => {
  z.object({ confirmation: z.literal('DELETE') }).parse(await c.req.json());
  const person = requireValue(await one<ContactRow>(c.env, 'SELECT * FROM contacts WHERE id=?', c.req.param('id')), 'Contact not found.');
  await deleteStoredData(c.env, { kind: 'contact', accountId: person.account_id, contactId: person.id, instagramId: person.instagram_id });
  return c.json({ ok: true });
});
api.delete('/api/accounts/:id', async c => {
  z.object({ confirmation: z.literal('DELETE') }).parse(await c.req.json());
  const account = requireValue(await one<{ id: string }>(c.env, `${accountSelect} WHERE id=?`, c.req.param('id')), 'Account not found.');
  await deleteStoredData(c.env, { kind: 'account', accountId: account.id });
  return c.json({ ok: true });
});
