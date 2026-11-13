import { z } from 'zod';
import { campaignInputSchema, type Button, type CampaignInput, type FlowNode } from '../shared/domain';
import { digest } from './auth';
import { action, baseUrl, buttons, contact, demoAllowed, now, one, rows, run, statement, uid, type AccountRow, type ActionRow, type CampaignRow, type ContactRow, type Env, type RunRow } from './core';
import { eventSchema, type Event } from './events';
import { bindNext, send, syncAccount } from './meta';

function matches(input: CampaignInput, text: string) {
  const normalized = text.normalize('NFKC').toLocaleLowerCase('en');
  const contains = (word: string) => input.matching.mode === 'whole_word' ? new RegExp(`(^|[^\\p{L}\\p{N}_])${word.toLocaleLowerCase('en').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_])`, 'u').test(normalized) : normalized.includes(word.toLocaleLowerCase('en'));
  return !input.matching.exclude.some(contains) && (input.matching.mode === 'any' || input.matching.include.some(contains));
}
async function campaignInput(env: Env, versionId: string) { const version = await one<{ input: string }>(env, 'SELECT input FROM versions WHERE id=?', versionId); if (!version) throw new Error('Published version is missing'); return campaignInputSchema.parse(JSON.parse(version.input)); }
async function processComment(env: Env, event: Extract<Event, { kind: 'comment' }>) {
  const time = await now(env);
  const account = await one<AccountRow>(env, 'SELECT * FROM accounts WHERE id=?', event.accountId); if (!account) return;
  const pending = await one(env, "SELECT id FROM campaigns WHERE account_id=? AND status='live' AND live_target_kind='next' AND bound_media_id IS NULL", event.accountId);
  if (pending) { if (account.mode === 'live') await syncAccount(env, account); else await bindNext(env, account.id); }
  if (pending && !await one(env, 'SELECT id FROM media WHERE account_id=? AND id=?', event.accountId, event.mediaId)) throw new Error('Waiting for media discovery');
  const candidates = await rows<CampaignRow>(env, "SELECT * FROM campaigns WHERE account_id=? AND status='live' AND live_version_id IS NOT NULL AND armed_at<=?", event.accountId, event.timestamp);
  const eligible: { campaign: CampaignRow; input: CampaignInput }[] = [];
  for (const campaign of candidates) {
    if (!campaign.live_version_id) continue;
    const input = await campaignInput(env, campaign.live_version_id);
    const targeted = input.target.kind === 'all' || (input.target.kind === 'specific' ? input.target.mediaId === event.mediaId : campaign.bound_media_id === event.mediaId);
    if (targeted && matches(input, event.text)) eligible.push({ campaign, input });
  }
  eligible.sort((a, b) => Number(b.input.target.kind !== 'all') - Number(a.input.target.kind !== 'all') || b.input.priority - a.input.priority || a.campaign.created_at - b.campaign.created_at || a.campaign.id.localeCompare(b.campaign.id));
  const winner = eligible[0];
  const contactId = await digest(`${event.accountId}:${event.senderId}`);
  const runId = winner ? await digest(`run:${event.accountId}:${event.commentId}`) : null;
  const statements = [statement(env, 'INSERT INTO contacts(id,account_id,instagram_id,username,created_at) VALUES(?,?,?,?,?) ON CONFLICT(account_id,instagram_id) DO UPDATE SET username=excluded.username', contactId, event.accountId, event.senderId, event.username, time)];
  if (winner && runId) {
    statements.push(statement(env, 'INSERT OR IGNORE INTO runs(id,account_id,contact_id,campaign_id,version_id,comment_id,media_id,node_id,state,comment_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', runId, event.accountId, contactId, winner.campaign.id, winner.campaign.live_version_id, event.commentId, event.mediaId, winner.input.privateReply ? winner.input.flow.entry : null, 'running', event.timestamp, time, time));
    if (winner.input.publicReply) {
      const variation = winner.input.replyVariations[parseInt((await digest(event.commentId)).slice(0, 8), 16) % winner.input.replyVariations.length] ?? '';
      statements.push(statement(env, "INSERT OR IGNORE INTO actions(id,account_id,run_id,node_id,kind,text,available_at,created_at,updated_at) VALUES(?,?,?,'public','public',?,?,?,?)", `${runId}:public`, event.accountId, runId, variation, time, time, time));
    }
  }
  statements.push(statement(env, "INSERT OR IGNORE INTO messages(id,account_id,contact_id,run_id,direction,channel,text,status,created_at) VALUES(?,?,?,?,'in','public',?,'received',?)", event.id, event.accountId, contactId, runId, event.text, event.timestamp), statement(env, 'UPDATE events SET applied_at=? WHERE id=?', time, event.id));
  await env.DB.batch(statements);
  if (runId) await resumeRun(env, runId);
}
async function processResponse(env: Env, event: Extract<Event, { kind: 'response' }>) {
  const time = await now(env);
  await run(env, 'INSERT OR IGNORE INTO contacts(id,account_id,instagram_id,username,created_at) VALUES(?,?,?,?,?)', await digest(`${event.accountId}:${event.senderId}`), event.accountId, event.senderId, event.username, time);
  const person = await one<ContactRow>(env, 'SELECT * FROM contacts WHERE account_id=? AND instagram_id=?', event.accountId, event.senderId);
  if (!person) throw new Error('Missing response contact');
  let active: RunRow | null = null;
  let target: string | null = null;
  let emailCaptured = false;
  if (event.payload) {
    const token = await one<{ run_id: string; node_id: string; next_node_id: string }>(env, 'SELECT * FROM response_tokens WHERE token=? AND account_id=? AND contact_id=? AND used_at IS NULL', event.payload, event.accountId, person.id);
    if (token) {
      active = await one<RunRow>(env, "SELECT * FROM runs WHERE id=? AND node_id=? AND state='waiting'", token.run_id, token.node_id);
      if (active) target = token.next_node_id;
    }
  } else {
    active = await one<RunRow>(env, "SELECT * FROM runs WHERE account_id=? AND contact_id=? AND state='waiting' ORDER BY created_at DESC LIMIT 1", event.accountId, person.id);
    if (active && active.node_id) {
      const input = await campaignInput(env, active.version_id);
      const node = input.flow.nodes.find(node => node.id === active?.node_id);
      if (node?.kind === 'collect') {
        const value = event.text.trim();
        if (value && (node.field !== 'email' || z.email().safeParse(value).success)) { const fields = contact(person).fields; fields[node.field] = value; person.fields = JSON.stringify(fields); emailCaptured = node.field === 'email'; target = node.next; }
      } else if (node?.kind === 'message' && node.buttons.every(button => button.kind !== 'reply')) target = node.next;
    }
  }
  const statements = [statement(env, "INSERT OR IGNORE INTO messages(id,account_id,contact_id,run_id,direction,channel,text,status,created_at) VALUES(?,?,?,?,'in','dm',?,'received',?)", event.id, event.accountId, person.id, active?.id ?? null, event.text, event.timestamp)];
  if (active && event.timestamp >= active.created_at && target) {
    statements.push(statement(env, "UPDATE runs SET node_id=?,state='running',wake_at=NULL,last_event_id=?,updated_at=? WHERE id=? AND node_id=? AND state='waiting' AND NOT EXISTS(SELECT 1 FROM events WHERE id=? AND applied_at IS NOT NULL)", target, event.id, time, active.id, active.node_id, event.id));
    statements.push(statement(env, 'UPDATE contacts SET fields=?,last_interaction_at=MAX(COALESCE(last_interaction_at,0),?) WHERE id=? AND EXISTS(SELECT 1 FROM runs WHERE id=? AND last_event_id=?)', person.fields, event.timestamp, person.id, active.id, event.id));
    if (event.payload) statements.push(statement(env, 'UPDATE response_tokens SET used_at=? WHERE token=? AND EXISTS(SELECT 1 FROM runs WHERE id=? AND last_event_id=?)', time, event.payload, active.id, event.id), statement(env, 'INSERT OR IGNORE INTO responses(event_id,account_id,contact_id,run_id,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM runs WHERE id=? AND last_event_id=?)', event.id, event.accountId, person.id, active.id, time, active.id, event.id));
    if (emailCaptured) statements.push(statement(env, 'INSERT OR IGNORE INTO email_captures(event_id,account_id,contact_id,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM runs WHERE id=? AND last_event_id=?)', event.id, event.accountId, person.id, time, active.id, event.id));
  } else if (!event.payload) statements.push(statement(env, 'UPDATE contacts SET last_interaction_at=MAX(COALESCE(last_interaction_at,0),?) WHERE id=?', event.timestamp, person.id));
  statements.push(statement(env, 'UPDATE events SET applied_at=? WHERE id=?', time, event.id));
  await env.DB.batch(statements);
  if (active && target) await resumeRun(env, active.id);
}
export async function processJob(env: Env, id: string) {
  const time = await now(env);
  const claimed = await statement(env, "UPDATE outbox SET state='processing',lease_until=?,attempts=attempts+1 WHERE id=? AND (state IN ('pending','queued') OR (state='processing' AND lease_until<?)) AND available_at<=? RETURNING event_id", time + 60000, id, time, time).first<{ event_id: string }>();
  if (!claimed) return;
  try {
    const record = await one<{ payload: string; applied_at: number | null }>(env, 'SELECT payload,applied_at FROM events WHERE id=?', claimed.event_id);
    if (record && !record.applied_at) { const event = eventSchema.parse(JSON.parse(record.payload)); if (event.kind === 'comment') await processComment(env, event); else await processResponse(env, event); }
    await run(env, "UPDATE outbox SET state='done',lease_until=NULL,error=NULL WHERE id=?", id);
  } catch {
    await run(env, "UPDATE outbox SET state='pending',available_at=?,lease_until=NULL,error='Processing failed; scheduled for recovery.' WHERE id=?", time + 60000, id);
  }
}
async function preparePayload(env: Env, item: ActionRow, journey: RunRow, person: ContactRow) {
  if (item.payload) return JSON.parse(item.payload);
  const savedButtons = buttons.parse(JSON.parse(item.buttons));
  const outboundButtons: ({ type: 'postback'; title: string; payload: string } | { type: 'web_url'; title: string; url: string })[] = [];
  const visibleButtons: Button[] = [];
  for (const [index, button] of savedButtons.entries()) {
    if (button.kind === 'reply') {
      await run(env, 'INSERT OR IGNORE INTO response_tokens(token,account_id,contact_id,run_id,node_id,next_node_id,choice) VALUES(?,?,?,?,?,?,?)', uid(), journey.account_id, journey.contact_id, journey.id, item.node_id, button.next, index);
      const record = await one<{ token: string }>(env, 'SELECT token FROM response_tokens WHERE run_id=? AND node_id=? AND choice=?', journey.id, item.node_id, index);
      if (!record) throw new Error('Missing response token');
      outboundButtons.push({ type: 'postback', title: button.label, payload: record.token }); visibleButtons.push(button);
    } else {
      await run(env, 'INSERT OR IGNORE INTO links(token,account_id,campaign_id,run_id,contact_id,action_id,destination,choice) VALUES(?,?,?,?,?,?,?,?)', uid(), journey.account_id, journey.campaign_id, journey.id, journey.contact_id, item.id, button.url, index);
      const record = await one<{ token: string }>(env, 'SELECT token FROM links WHERE action_id=? AND choice=?', item.id, index); if (!record) throw new Error('Missing tracked link');
      const url = `${baseUrl(env)}/r/${record.token}`;
      outboundButtons.push({ type: 'web_url', title: button.label, url }); visibleButtons.push({ ...button, url });
    }
  }
  const message = outboundButtons.length ? { attachment: { type: 'template', payload: { template_type: 'button', text: item.text, buttons: outboundButtons } } } : { text: item.text };
  const payload = item.kind === 'public' ? { message: item.text } : { recipient: item.kind === 'private' ? { comment_id: journey.comment_id } : { id: person.instagram_id }, message };
  await run(env, 'UPDATE actions SET payload=?,buttons=? WHERE id=?', JSON.stringify(payload), JSON.stringify(visibleButtons), item.id);
  return payload;
}
async function executeAction(env: Env, item: ActionRow, journey: RunRow, person: ContactRow): Promise<'done' | 'wait' | 'stop'> {
  if (item.status === 'succeeded') return 'done';
  if (item.status === 'uncertain' || item.status === 'failed') { await run(env, 'UPDATE runs SET state=?,updated_at=? WHERE id=?', item.status, await now(env), journey.id); return 'stop'; }
  const time = await now(env);
  if (item.status === 'executing') {
    if (item.updated_at + 60000 > time) return 'wait';
    await env.DB.batch([statement(env, "UPDATE actions SET status='uncertain',error='Worker stopped during send. Delivery is unknown.',updated_at=? WHERE id=? AND status='executing'", time, item.id), statement(env, "UPDATE runs SET state='uncertain',updated_at=? WHERE id=?", time, journey.id)]);
    return 'stop';
  }
  if (item.available_at > time) { await run(env, 'UPDATE runs SET wake_at=? WHERE id=?', item.available_at, journey.id); return 'wait'; }
  const expires = item.kind === 'private' ? journey.comment_at + 7 * 86400000 : item.kind === 'dm' ? (person.last_interaction_at ?? 0) + 86400000 : Infinity;
  if (expires <= time) { await env.DB.batch([statement(env, "UPDATE runs SET state='expired',updated_at=? WHERE id=?", time, journey.id), statement(env, "UPDATE actions SET status='failed',error='Messaging window expired.',updated_at=? WHERE id=?", time, item.id)]); return 'stop'; }
  const account = await one<AccountRow>(env, 'SELECT * FROM accounts WHERE id=?', journey.account_id); if (!account) throw new Error('Missing account');
  const pacing = demoAllowed(env) && account.mode === 'demo' ? 0 : 1100;
  const slot = await statement(env, 'UPDATE accounts SET next_send_at=? WHERE id=? AND next_send_at<=? RETURNING id', time + pacing, account.id, time).first();
  if (!slot) { await run(env, 'UPDATE runs SET wake_at=? WHERE id=?', time + 1500, journey.id); return 'wait'; }
  const payload = await preparePayload(env, item, journey, person);
  const claimed = await statement(env, "UPDATE actions SET status='executing',attempts=attempts+1,updated_at=? WHERE id=? AND status='pending' RETURNING id", time, item.id).first(); if (!claimed) return 'wait';
  const result = await send(env, account, { id: item.id, kind: item.kind, commentId: journey.comment_id, payload });
  const currentButtons = await one<{ buttons: string }>(env, 'SELECT buttons FROM actions WHERE id=?', item.id);
  if (result.kind === 'accepted') {
    await env.DB.batch([statement(env, "UPDATE actions SET status='succeeded',provider_id=?,error=NULL,updated_at=? WHERE id=?", result.id, time, item.id), statement(env, "INSERT OR IGNORE INTO messages(id,account_id,contact_id,run_id,direction,channel,text,buttons,status,created_at) VALUES(?,?,?,?,'out',?,?,?,'accepted',?)", item.id, journey.account_id, person.id, journey.id, item.kind === 'public' ? 'public' : 'dm', item.text, currentButtons?.buttons ?? '[]', time), ...(item.kind === 'private' ? [statement(env, 'UPDATE runs SET private_sent=1 WHERE id=?', journey.id)] : [])]);
    return 'done';
  }
  if (result.kind === 'rejected' && result.retry && item.attempts < 4) { const retryAt = time + Math.min(3600000, 60000 * 2 ** item.attempts); await env.DB.batch([statement(env, "UPDATE actions SET status='pending',available_at=?,error=?,updated_at=? WHERE id=?", retryAt, result.error, time, item.id), statement(env, 'UPDATE runs SET wake_at=? WHERE id=?', retryAt, journey.id)]); return 'wait'; }
  const status = result.kind === 'uncertain' ? 'uncertain' : 'failed';
  await env.DB.batch([statement(env, 'UPDATE actions SET status=?,error=?,updated_at=? WHERE id=?', status, result.error, time, item.id), statement(env, 'UPDATE runs SET state=?,updated_at=? WHERE id=?', status, time, journey.id), statement(env, "INSERT OR IGNORE INTO messages(id,account_id,contact_id,run_id,direction,channel,text,buttons,status,created_at) VALUES(?,?,?,?,'out',?,?,?,?,?)", item.id, journey.account_id, person.id, journey.id, item.kind === 'public' ? 'public' : 'dm', item.text, currentButtons?.buttons ?? '[]', status, time)]);
  return 'stop';
}
export async function resumeRun(env: Env, runId: string) {
  const time = await now(env);
  const acquired = await statement(env, "UPDATE runs SET lock_until=? WHERE id=? AND lock_until<=? AND state IN ('running','waiting','delayed') RETURNING *", time + 60000, runId, time).first<RunRow>();
  if (!acquired) return;
  try {
    let journey = acquired;
    const person = await one<ContactRow>(env, 'SELECT * FROM contacts WHERE id=?', journey.contact_id); if (!person) throw new Error('Missing contact');
    const input = await campaignInput(env, journey.version_id);
    const publicAction = await one<ActionRow>(env, "SELECT * FROM actions WHERE run_id=? AND kind='public'", runId);
    if (publicAction && await executeAction(env, publicAction, journey, person) !== 'done') return;
    if (!input.privateReply) { await run(env, "UPDATE runs SET state='complete',updated_at=? WHERE id=?", time, runId); return; }
    for (let step = 0; step <= input.flow.nodes.length; step++) {
      await run(env, 'UPDATE runs SET lock_until=? WHERE id=?', await now(env) + 60000, runId);
      if (journey.wake_at && journey.wake_at > time) return;
      const node = input.flow.nodes.find(node => node.id === journey.node_id);
      if (!node) throw new Error('Missing flow node');
      if (journey.state === 'waiting') {
        const expiry = person.last_interaction_at ? person.last_interaction_at + 86400000 : journey.comment_at + 7 * 86400000;
        await run(env, 'UPDATE runs SET state=?,updated_at=? WHERE id=?', time >= expiry ? 'expired' : 'waiting', time, runId);
        return;
      }
      let next: string | null = null;
      switch (node.kind) {
        case 'message': case 'collect': {
          const existing = await one<ActionRow>(env, "SELECT * FROM actions WHERE run_id=? AND node_id=? AND kind!='public'", runId, node.id);
          const kind = existing?.kind ?? (journey.private_sent ? 'dm' : 'private');
          if (kind === 'dm' && !person.last_interaction_at) { await run(env, "UPDATE runs SET state='waiting',updated_at=? WHERE id=?", time, runId); return; }
          const actionId = `${runId}:${node.id}:${kind}`;
          await run(env, 'INSERT OR IGNORE INTO actions(id,account_id,run_id,node_id,kind,text,buttons,available_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', actionId, journey.account_id, runId, node.id, kind, node.kind === 'message' ? node.text : node.prompt, JSON.stringify(node.kind === 'message' ? node.buttons : []), time, time, time);
          const item = await one<ActionRow>(env, 'SELECT * FROM actions WHERE id=?', actionId); if (!item) throw new Error('Missing action');
          if (await executeAction(env, item, journey, person) !== 'done') return;
          journey.private_sent = 1;
          if (node.kind === 'collect' || node.buttons.some(button => button.kind === 'reply')) { await run(env, "UPDATE runs SET state='waiting',wake_at=NULL,updated_at=? WHERE id=?", time, runId); return; }
          next = node.next;
          if (kind === 'private' && next) {
            const nextNode = input.flow.nodes.find(node => node.id === next);
            if (nextNode?.kind !== 'end') { await run(env, "UPDATE runs SET state='waiting',wake_at=NULL,updated_at=? WHERE id=?", time, runId); return; }
          }
          break;
        }
        case 'condition': {
          const personData = contact(person); const value = personData.fields[node.field] ?? '';
          const yes = node.operator === 'has_tag' ? personData.tags.includes(node.value) : node.operator === 'is_set' ? !!value : node.operator === 'equals' ? value.toLocaleLowerCase() === node.value.toLocaleLowerCase() : value.toLocaleLowerCase().includes(node.value.toLocaleLowerCase());
          next = yes ? node.yes : node.no; break;
        }
        case 'action': { const tags = [...new Set([...contact(person).tags, node.tag])]; person.tags = JSON.stringify(tags); await run(env, 'UPDATE contacts SET tags=? WHERE id=?', person.tags, person.id); next = node.next; break; }
        case 'delay':
          if (journey.state !== 'delayed') { await run(env, "UPDATE runs SET state='delayed',wake_at=?,updated_at=? WHERE id=?", time + node.seconds * 1000, time, runId); return; }
          next = node.next; break;
        case 'end': await run(env, 'UPDATE runs SET state=?,wake_at=NULL,updated_at=? WHERE id=?', node.outcome, time, runId); return;
        default: { const exhaustive: never = node; throw new Error(`Unsupported node ${exhaustive}`); }
      }
      if (!next) { await run(env, "UPDATE runs SET state='complete',wake_at=NULL,updated_at=? WHERE id=?", time, runId); return; }
      await run(env, "UPDATE runs SET node_id=?,state='running',wake_at=NULL,updated_at=? WHERE id=?", next, time, runId);
      journey = { ...journey, node_id: next, state: 'running', wake_at: null };
    }
  } finally { await run(env, 'UPDATE runs SET lock_until=0 WHERE id=?', runId); }
}
export async function drain(env: Env) {
  const time = await now(env);
  const pending = await rows<{ id: string }>(env, "SELECT id FROM outbox WHERE state!='done' AND available_at<=? AND (state!='processing' OR lease_until<?) ORDER BY available_at LIMIT 100", time, time);
  for (const job of pending) await processJob(env, job.id);
  const journeys = await rows<{ id: string }>(env, "SELECT id FROM runs WHERE state IN ('running','waiting','delayed') AND (wake_at IS NULL OR wake_at<=?) ORDER BY CASE WHEN state='waiting' THEN 1 ELSE 0 END,updated_at LIMIT 100", time);
  for (const journey of journeys) await resumeRun(env, journey.id);
}
