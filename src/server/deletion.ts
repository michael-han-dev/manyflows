import { digest } from './auth';
import { ApiError, rows, statement, type Env } from './core';

type DeletionScope = { kind: 'account'; accountId: string } | { kind: 'contact'; accountId: string; contactId: string; instagramId: string };
export async function deleteStoredData(env: Env, scope: DeletionScope) {
  const personWhere = scope.kind === 'account' ? 'account_id=?' : 'contact_id=?';
  const personArgs = [scope.kind === 'account' ? scope.accountId : scope.contactId];
  const eventWhere = scope.kind === 'account' ? 'events.account_id=?' : "events.account_id=? AND json_extract(events.payload,'$.senderId')=?";
  const eventArgs = scope.kind === 'account' ? [scope.accountId] : [scope.accountId, scope.instagramId];
  const safe = `NOT EXISTS(SELECT 1 FROM runs WHERE ${personWhere} AND lock_until>?)
    AND NOT EXISTS(SELECT 1 FROM actions WHERE run_id IN (SELECT id FROM runs WHERE ${personWhere}) AND status='executing')
    AND NOT EXISTS(SELECT 1 FROM outbox JOIN events ON events.id=outbox.event_id WHERE ${eventWhere} AND outbox.state='processing')`;
  const guardArgs = [...personArgs, Date.now(), ...personArgs, ...eventArgs];
  const guarded = (sql: string, args: (string | number)[]) => statement(env, `${sql} AND ${safe}`, ...args, ...guardArgs);
  const legacy = await rows<{ id: string }>(env, `SELECT id FROM events WHERE ${eventWhere} AND receipt_hash IS NULL`, ...eventArgs);
  const receipts = await Promise.all(legacy.map(event => digest(event.id)));
  const statements = [
    guarded(`DELETE FROM clicks WHERE ${personWhere}`, personArgs),
    guarded(`DELETE FROM links WHERE ${personWhere}`, personArgs),
    guarded(`DELETE FROM response_tokens WHERE ${personWhere}`, personArgs),
    guarded(`DELETE FROM demo_requests WHERE action_id IN (SELECT id FROM actions WHERE run_id IN (SELECT id FROM runs WHERE ${personWhere}))`, personArgs),
    guarded(`DELETE FROM actions WHERE run_id IN (SELECT id FROM runs WHERE ${personWhere})`, personArgs),
    guarded(`DELETE FROM messages WHERE ${personWhere}`, personArgs),
    guarded(`DELETE FROM responses WHERE ${personWhere}`, personArgs),
    guarded(`DELETE FROM email_captures WHERE ${personWhere}`, personArgs),
    guarded(`UPDATE runs SET last_event_id=NULL WHERE last_event_id IN (SELECT id FROM events WHERE ${eventWhere})`, eventArgs),
    guarded(`DELETE FROM runs WHERE ${personWhere}`, personArgs),
    guarded(`DELETE FROM outbox WHERE event_id IN (SELECT id FROM events WHERE ${eventWhere})`, eventArgs),
    guarded(`DELETE FROM events WHERE ${eventWhere}`, eventArgs),
  ];
  for (let start = 0; start < receipts.length; start += 1000) statements.unshift(guarded('INSERT OR IGNORE INTO event_receipts(digest) SELECT value FROM json_each(?) WHERE 1', [JSON.stringify(receipts.slice(start, start + 1000))]));
  if (scope.kind === 'account') {
    statements.push(
      guarded('DELETE FROM contacts WHERE account_id=?', [scope.accountId]),
      guarded('DELETE FROM versions WHERE campaign_id IN (SELECT id FROM campaigns WHERE account_id=?)', [scope.accountId]),
      guarded('DELETE FROM campaigns WHERE account_id=?', [scope.accountId]),
      guarded('DELETE FROM media WHERE account_id=?', [scope.accountId]),
      guarded('DELETE FROM metric_snapshots WHERE account_id=?', [scope.accountId]),
      guarded('DELETE FROM demo_requests WHERE account_id=?', [scope.accountId]),
      guarded("DELETE FROM settings WHERE (key IN (?,?,?) OR substr(key,1,length(?))=?)", [`failure:${scope.accountId}`, `job-failure:${scope.accountId}`, `pacing:${scope.accountId}`, `send-barrier:${scope.accountId}:`, `send-barrier:${scope.accountId}:`]),
      guarded('DELETE FROM accounts WHERE id=?', [scope.accountId]),
    );
  } else statements.push(guarded('DELETE FROM contacts WHERE id=?', [scope.contactId]));
  const deletedIndex = statements.length - 1;
  if (scope.kind === 'account') statements.push(guarded('DELETE FROM meta_grants WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE accounts.grant_id=meta_grants.id)', []));
  const result = await env.DB.batch(statements);
  if (result[deletedIndex]?.meta.changes !== 1) throw new ApiError(409, 'Data deletion is busy because processing or a send is in progress. Wait for that work to finish, then retry.');
}
