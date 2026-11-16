import { useState, type FormEvent } from 'react';
import { ApiError } from '../api';
import { Button, Dialog, Field, Spinner } from './ui';

export function DeleteDataDialog({ kind, username, accountUsername, onClose, onConfirm }: { kind: 'contact' | 'account'; username: string; accountUsername?: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (confirmation !== 'DELETE' || busy) return;
    setBusy(true); setError(null);
    try { await onConfirm(); }
    catch (error) { setError(error instanceof ApiError && error.status === 409 ? `Active work is using this ${kind}. Try again after the active execution finishes.` : error instanceof Error ? error.message : `The ${kind} could not be deleted.`); }
    finally { setBusy(false); }
  }
  return <Dialog title={kind === 'contact' ? 'Delete contact' : 'Delete account'} onClose={onClose}><form className="delete-data-form" onSubmit={event => void submit(event)}><p>This permanently removes <strong>@{username}</strong>{kind === 'contact' && accountUsername ? <> from <strong>@{accountUsername}</strong></> : ''} and its stored {kind === 'contact' ? 'contact details, conversation history, and campaign journeys' : 'account token, contacts, conversations, campaigns, and content records'} from this application. This cannot be undone.</p>{kind === 'account' ? <p>Your Instagram account and remote Instagram content are not deleted.</p> : <p>A future incoming interaction can create this contact again.</p>}<Field label="Type DELETE"><input aria-label="Type DELETE" autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /></Field>{error && <div className="alert error" role="alert">{error}</div>}<div className="dialog-actions"><Button type="button" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="danger" type="submit" disabled={confirmation !== 'DELETE' || busy}>{busy && <Spinner />}Permanently delete {kind}</Button></div></form></Dialog>;
}
