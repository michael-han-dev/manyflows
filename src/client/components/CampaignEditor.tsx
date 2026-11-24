import { MediaThumbnail } from './MediaThumbnail';
import { MoreActions } from './MoreActions';
import { useEffect, useState } from 'react';
import { ArrowLeftIcon as ArrowLeft, CheckIcon as Check, CopyIcon as Copy, FileTextIcon as FileText, ImageIcon as Image, LayersIcon as Layers3, PauseIcon as Pause, PlayIcon as Play, PlusIcon as Plus, CheckIcon as Save, MagicWandIcon as Sparkles, TrashIcon as Trash2 } from '@radix-ui/react-icons';
import { BUTTON_LABEL_LIMIT, BUTTON_MESSAGE_LIMIT, MAX_MESSAGE_BUTTONS, MAX_DELAY_SECONDS, MESSAGE_TEXT_LIMIT, buttonSchema, campaignInputSchema, validateFlow, type Account, type Button as FlowButton, type Campaign, type CampaignInput, type Media } from '../../shared/domain';
import { Select, IconButton, Button, date, Dialog, Field, Icon, Spinner, Toggle } from './ui';
import { CampaignPreview } from './CampaignPreview';
import { readTemplate, starterFlow, writeTemplate, type TemplateModel } from './flow-model';
import { getBootstrap } from '../api';

const campaignStatusLabels = { draft: 'Draft', live: 'Published', paused: 'Paused' } satisfies Record<Campaign['status'], string>;

type UrlButton = Extract<FlowButton, { kind: 'url' }>;
type LinkDialog = { index: number | null; label: string; url: string };
type Props = {
  campaign: Campaign | null; initial: CampaignInput; accounts: Account[]; media: Media[];
  onBack: () => void; onSave: (input: CampaignInput, publish: boolean) => Promise<void>;
  onPause: () => Promise<void>; onDuplicate: (accountId: string) => Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
};

export function CampaignEditor({ campaign, initial, accounts, media, onBack, onSave, onPause, onDuplicate, onDirtyChange }: Props) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [cached, setCached] = useState(() => readTemplate(initial.flow));
  const [linkDialog, setLinkDialog] = useState<LinkDialog | null>(null);
  const [linkError, setLinkError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDuplicate, setShowDuplicate] = useState(false);
  const [duplicateAccount, setDuplicateAccount] = useState(initial.accountId);
  const [replaceTemplate, setReplaceTemplate] = useState(false);
  const [include, setInclude] = useState(initial.matching.include.join(', '));
  const [exclude, setExclude] = useState(initial.matching.exclude.join(', '));
  const [pickerMedia, setPickerMedia] = useState(media);
  const [loadingMedia, setLoadingMedia] = useState(false);
  const dirty = JSON.stringify(draft) !== saved;
  const template = readTemplate(draft.flow);
  const issues = validateFlow(draft);
  const account = accounts.find(item => item.id === draft.accountId);
  const previewMedia = pickerMedia.find(item => item.accountId === draft.accountId && (draft.target.kind === 'all' || draft.target.kind === 'specific' && item.id === draft.target.mediaId));
  const mediaIds = media.map(item => `${item.accountId}:${item.id}`).join(',');
  useEffect(() => {
    if (!draft.accountId) return;
    let current = true;
    setLoadingMedia(true);
    getBootstrap(`?accountId=${encodeURIComponent(draft.accountId)}`).then(snapshot => { if (current) setPickerMedia(snapshot.media); }).catch(error => { if (current) setError(error instanceof Error ? error.message : 'Content could not be loaded.'); }).finally(() => { if (current) setLoadingMedia(false); });
    return () => { current = false; };
  }, [draft.accountId, mediaIds]);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty]);

  async function perform(name: string, action: () => Promise<void>) {
    setBusy(name); setError(null);
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : 'This change could not be saved.'); }
    finally { setBusy(null); }
  }

  async function save(publish: boolean) {
    const parsed = campaignInputSchema.safeParse(draft);
    const errors = [...(!parsed.success ? parsed.error.issues.map(issue => `${issue.path.join(' › ')}: ${issue.message}`) : []), ...(publish ? issues : [])];
    if (errors.length) { setError(errors.join('\n')); return; }
    await perform(publish ? 'publish' : 'save', async () => { await onSave(draft, publish); setSaved(JSON.stringify(draft)); });
  }

  function updateTemplate(patch: Partial<TemplateModel>) {
    if (!template) return;
    const next = { ...template,
      ...(!template.opening && cached ? { openingText: cached.openingText, openingButton: cached.openingButton } : {}),
      ...(!template.email && cached ? { emailPrompt: cached.emailPrompt } : {}),
      ...(!template.follow && cached ? { followText: cached.followText, followButton: cached.followButton } : {}),
      ...(!template.reminder && cached ? { reminderText: cached.reminderText, reminderSeconds: cached.reminderSeconds } : {}),
      ...patch };
    setCached(next);
    setDraft({ ...draft, flow: writeTemplate(next) });
  }
  function saveLink() {
    if (!linkDialog || !template) return;
    const raw = linkDialog.url.trim();
    const hostWithPort = /^(?:\[[^\]]+\]|[^:/?#]+):\d+(?:[/?#]|$)/.test(raw);
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
    const url = (hasScheme && !hostWithPort ? raw : `https://${raw}`).replace(/^https?:/i, scheme => scheme.toLowerCase());
    const parsed = buttonSchema.safeParse({ kind: 'url', label: linkDialog.label.trim(), url });
    if (!parsed.success || parsed.data.kind !== 'url') { setLinkError(`Enter a label of 1–${BUTTON_LABEL_LIMIT} characters and a valid HTTP or HTTPS URL.`); return; }
    const links: UrlButton[] = [...template.resourceLinks];
    if (linkDialog.index === null) links.push(parsed.data); else links[linkDialog.index] = parsed.data;
    updateTemplate({ resourceLinks: links }); setLinkDialog(null); setLinkError('');
  }

  return <div className="campaign-editor">
    <div className="editor-heading">
      <IconButton className="back-button" onClick={onBack} aria-label="Back to campaigns"><Icon icon={ArrowLeft} size={20} /></IconButton>
      <div className="editor-title">
        <h1>{campaign ? campaign.name : 'New campaign'}</h1>
        <p className="editor-save-state" role="status">{dirty ? campaign ? 'Unsaved changes' : 'Unsaved draft' : campaign ? 'All changes saved' : 'Not saved yet'}</p>
        {campaign?.liveVersionId && <p className="version-note">Running conversations keep their published version.</p>}
      </div>
      <div className="editor-actions" role="group" aria-label="Campaign actions">
        <span className="editor-state" role="status">{campaignStatusLabels[campaign?.status ?? 'draft']}</span>
        <Button onClick={() => void save(false)} disabled={Boolean(busy)}>{busy === 'save' ? <Spinner /> : <Icon icon={Save} size={16} />}Save draft</Button>
        <Button variant="primary" onClick={() => void save(true)} disabled={Boolean(busy) || !draft.accountId}>{busy === 'publish' ? <Spinner /> : <Icon icon={Play} size={16} />}{campaign?.status === 'live' ? 'Publish changes' : 'Publish campaign'}</Button>
        {campaign && <MoreActions label="More campaign actions" disabled={Boolean(busy)} actions={[
          ...(campaign.status === 'live' ? [{ label: 'Pause', icon: Pause, run: () => void perform('pause', onPause) }] : []),
          { label: 'Duplicate', icon: Copy, run: () => setShowDuplicate(true) },
        ]} />}
      </div>
    </div>
    {error && <div className="alert error" role="alert">{error}</div>}
    <div className="campaign-builder"><div className="editor-sections"><section className="card editor-section"><div className="section-heading"><span className="step-number">01</span><div><h2>Choose the starting point</h2><p>A new comment starts this conversation.</p></div></div><div className="form-grid"><Field label="Campaign name"><input aria-label="Campaign name" value={draft.name} maxLength={120} onChange={event => setDraft({ ...draft, name: event.target.value })} /></Field><Field label="Instagram account" hint={campaign ? 'Duplicate the campaign to use another account.' : undefined}><Select aria-label="Campaign account" disabled={Boolean(campaign)} value={draft.accountId} onChange={event => setDraft({ ...draft, accountId: event.target.value, target: draft.target.kind === 'specific' ? { kind: 'all' } : draft.target })}><option value="" disabled>Choose an account</option>{accounts.map(account => <option key={account.id} value={account.id}>@{account.username}{account.mode === 'demo' ? ' · Demo' : ''}</option>)}</Select></Field></div><Field label="Which content?"><div className="target-choices">{([{ kind: 'specific', title: 'Specific post or reel', description: 'Choose published content', icon: Image }, { kind: 'all', title: 'All posts and reels', description: 'Existing and future content', icon: Layers3 }, { kind: 'next', title: 'Next publication', description: 'Binds once when published', icon: Sparkles }] satisfies { kind: CampaignInput['target']['kind']; title: string; description: string; icon: typeof Image }[]).map(choice => <button className={`target-choice ${draft.target.kind === choice.kind ? 'selected' : ''}`} key={choice.kind} aria-pressed={draft.target.kind === choice.kind} onClick={() => setDraft({ ...draft, target: choice.kind === 'specific' ? { kind: 'specific', mediaId: pickerMedia.find(item => item.accountId === draft.accountId)?.id ?? '' } : { kind: choice.kind } })}><Icon icon={choice.icon} /><strong>{choice.title}</strong><small>{choice.description}</small></button>)}</div></Field>{draft.target.kind === 'specific' && loadingMedia && <p className="field-hint" role="status">Loading content for this account…</p>}{draft.target.kind === 'specific' && <div className="media-picker" role="group" aria-label="Choose content">{pickerMedia.filter(item => item.accountId === draft.accountId).length ? pickerMedia.filter(item => item.accountId === draft.accountId).map(item => <button key={item.id} className={`media-option ${draft.target.kind === 'specific' && draft.target.mediaId === item.id ? 'selected' : ''}`} aria-pressed={draft.target.kind === 'specific' && draft.target.mediaId === item.id} onClick={() => setDraft({ ...draft, target: { kind: 'specific', mediaId: item.id } })}><MediaThumbnail media={item} /><span><strong>{item.caption || 'Untitled post'}</strong><small>{item.type === 'REELS' ? 'Reel' : 'Post'} · {date(item.publishedAt)}</small></span><span className="radio-mark" /></button>) : <p className="muted">No content is synced for this account. Sync content in Settings, or choose all posts.</p>}</div>}{draft.target.kind === 'next' && <div className="note">The campaign waits for the earliest eligible post or reel published after activation, then stays attached to it. One pending next-publication campaign is allowed per account.</div>}</section>
      <section className="card editor-section"><div className="section-heading"><span className="step-number">02</span><div><h2>Match the right comments</h2><p>Give the right resource to the right person.</p></div></div><Field label="Comment matching"><Select aria-label="Comment matching" value={draft.matching.mode} onChange={event => { const mode = event.target.value; if (mode === 'any' || mode === 'whole_word' || mode === 'phrase') setDraft({ ...draft, matching: { ...draft.matching, mode } }); }}><option value="whole_word">Contains a whole keyword</option><option value="phrase">Contains a phrase</option><option value="any">Any comment</option></Select></Field>{draft.matching.mode !== 'any' && <Field label="Include keywords" hint="Separate keywords with commas or new lines. A match on any included keyword is enough."><textarea aria-label="Include keywords" rows={2} placeholder="GUIDE, link, please" value={include} onChange={event => { setInclude(event.target.value); setDraft({ ...draft, matching: { ...draft.matching, include: splitKeywords(event.target.value) } }); }} /></Field>}<Field label="Exclude keywords" hint="Exclusions always win. Matching ignores letter case. Whole words respect punctuation; phrase matching looks for consecutive text."><textarea aria-label="Exclude keywords" rows={2} placeholder="Optional words to skip" value={exclude} onChange={event => { setExclude(event.target.value); setDraft({ ...draft, matching: { ...draft.matching, exclude: splitKeywords(event.target.value) } }); }} /></Field><Field label="Priority" hint="Specific-post campaigns win before all-post campaigns. A higher priority number wins ties."><input className="short-input" aria-label="Campaign priority" type="number" min={0} max={1000} value={draft.priority} onChange={event => setDraft({ ...draft, priority: Number(event.target.value) })} /></Field></section>
      <section className="card editor-section"><div className="section-heading"><span className="step-number">03</span><div><h2>Reply in the comments</h2><p>A little acknowledgment goes a long way.</p></div></div><Toggle label="Public comment reply" hint="Rotate among your saved replies. Retries keep the chosen wording." checked={draft.publicReply} onChange={publicReply => setDraft({ ...draft, publicReply })} />{draft.publicReply && <div className="reply-list">{draft.replyVariations.map((reply, index) => <div className="reply-row" key={index}><span>{String(index + 1).padStart(2, '0')}</span><textarea aria-label={`Public reply ${index + 1}`} rows={2} maxLength={500} value={reply} onChange={event => setDraft({ ...draft, replyVariations: draft.replyVariations.map((existing, i) => i === index ? event.target.value : existing) })} /><IconButton className="danger" aria-label={`Remove public reply ${index + 1}`} onClick={() => setDraft({ ...draft, replyVariations: draft.replyVariations.filter((_, i) => i !== index) })}><Icon icon={Trash2} size={16} /></IconButton></div>)}<Button size="small" onClick={() => setDraft({ ...draft, replyVariations: [...draft.replyVariations, ''] })} disabled={draft.replyVariations.length >= 100}><Icon icon={Plus} size={15} />Add reply variation</Button><p className="field-hint">Save up to 100 variations. This list can contain more than three replies.</p></div>}</section>
      <section className="card editor-section"><div className="section-heading"><span className="step-number">04</span><div><h2>Start a private conversation</h2><p>Continue from a comment into the inbox.</p></div></div>
        <Toggle label="Private message" hint="Send a private reply to the commenter." checked={draft.privateReply} onChange={privateReply => setDraft({ ...draft, privateReply })} />
        {draft.privateReply && template && <><Toggle label="Opening message" hint="A response button lets the person continue the conversation." checked={template.opening} onChange={opening => updateTemplate({ opening, ...(!opening ? { email: false, follow: false, reminder: false } : {}) })} />
          {!template.opening && <p className="field-hint">Turning on email, follow confirmation or a reminder also enables the opening message. Turning it off disables those steps.</p>}
          {template.opening && <><TextField label="Opening message" value={template.openingText} limit={BUTTON_MESSAGE_LIMIT} onChange={openingText => updateTemplate({ openingText })} /><TextField label="Opening button label" value={template.openingButton} limit={BUTTON_LABEL_LIMIT} single onChange={openingButton => updateTemplate({ openingButton })} /></>}</>}
        {draft.privateReply && !template && <div className="note"><strong>This campaign has a custom flow.</strong><p>Editing campaign settings preserves the custom conversation.</p><button className="text-button" onClick={() => setReplaceTemplate(true)}>Replace with link template</button></div>}
      </section>
      {draft.privateReply && template && <>
        <section className="card editor-section"><div className="section-heading"><span className="step-number">05</span><div><h2>Collect an email</h2><p>Optional, after the opening response.</p></div></div><Toggle label="Collect an email" hint="Ask for a valid email before the next step." checked={template.email} onChange={email => updateTemplate({ email, ...(email ? { opening: true } : {}) })} />{template.email && <TextField label="Email collection prompt" value={template.emailPrompt} limit={MESSAGE_TEXT_LIMIT} onChange={emailPrompt => updateTemplate({ emailPrompt })} />}</section>
        <section className="card editor-section"><div className="section-heading"><span className="step-number">06</span><div><h2>Ask to follow</h2><p>Optional, before delivering the resource.</p></div></div><Toggle label="Require a follow" hint="Instagram verifies they follow you before sending the resource. If they do not, each button tap repeats the prompt." checked={template.follow} onChange={follow => updateTemplate({ follow, ...(follow ? { opening: true } : {}) })} />{template.follow && <><TextField label="Follow request message" value={template.followText} limit={BUTTON_MESSAGE_LIMIT} onChange={followText => updateTemplate({ followText })} /><TextField label="Follow check button label" value={template.followButton} limit={BUTTON_LABEL_LIMIT} single onChange={followButton => updateTemplate({ followButton })} /></>}</section>
        <section className="card editor-section"><div className="section-heading"><span className="step-number">07</span><div><h2>Deliver your resource</h2><p>Send a message with up to {MAX_MESSAGE_BUTTONS} optional links.</p></div></div><TextField label="Resource message" value={template.resourceText} limit={template.resourceLinks.length ? BUTTON_MESSAGE_LIMIT : MESSAGE_TEXT_LIMIT} onChange={resourceText => updateTemplate({ resourceText })} />
          <div className="resource-links">{template.resourceLinks.map((link, index) => <div className="resource-link" key={index}><div><strong>{link.label}</strong><small>{link.url}</small></div><button className="text-button" onClick={() => { setLinkError(''); setLinkDialog({ index, label: link.label, url: link.url }); }}>Edit<span className="sr-only"> link {index + 1}</span></button><IconButton className="danger" aria-label={`Remove link ${index + 1}`} onClick={() => updateTemplate({ resourceLinks: template.resourceLinks.filter((_, i) => i !== index) })}><Icon icon={Trash2} size={16} /></IconButton></div>)}</div>
          <Button size="small" disabled={template.resourceLinks.length >= MAX_MESSAGE_BUTTONS} onClick={() => { setLinkError(''); setLinkDialog({ index: null, label: '', url: '' }); }}><Icon icon={Plus} size={15} />Add link</Button><p className="field-hint">A link visit is tracked but does not count as a reply or open the messaging window.</p></section>
        <section className="card editor-section"><div className="section-heading"><span className="step-number">08</span><div><h2>Send a reminder</h2><p>Optional follow-up after the resource.</p></div></div><Toggle label="Send a reminder" hint="Send only if none of the tracked links in this conversation were visited. An open messaging window is required." checked={template.reminder} onChange={reminder => updateTemplate({ reminder, ...(reminder ? { opening: true } : {}) })} />{template.reminder && <><Field label="Wait before reminder (minutes)"><input className="short-input" aria-label="Reminder minutes" type="number" min={1 / 60} max={MAX_DELAY_SECONDS / 60} step="any" value={template.reminderSeconds / 60} onChange={event => updateTemplate({ reminderSeconds: Math.round(Number(event.target.value) * 60) })} /></Field><TextField label="Reminder message" value={template.reminderText} limit={MESSAGE_TEXT_LIMIT} onChange={reminderText => updateTemplate({ reminderText })} /></>}</section>
      </>}
      <Validation issues={issues} />
    </div><CampaignPreview draft={draft} account={account} media={previewMedia} /></div>
    {linkDialog && <Dialog title={linkDialog.index === null ? 'Add link' : 'Edit link'} onClose={() => setLinkDialog(null)}><Field label="Button label" hint={`${linkDialog.label.length} / ${BUTTON_LABEL_LIMIT} characters`}><input aria-label="Link button label" maxLength={BUTTON_LABEL_LIMIT} value={linkDialog.label} onChange={event => setLinkDialog({ ...linkDialog, label: event.target.value })} /></Field><Field label="Website URL" hint="HTTPS is added if you omit it."><input aria-label="Link URL" placeholder="example.com" value={linkDialog.url} onChange={event => setLinkDialog({ ...linkDialog, url: event.target.value })} /></Field>{linkError && <p className="link-error" role="alert">{linkError}</p>}<div className="dialog-actions"><Button onClick={() => setLinkDialog(null)}>Cancel</Button><Button variant="primary" onClick={saveLink}>Save link</Button></div></Dialog>}
    {showDuplicate && <Dialog title="Duplicate campaign" onClose={() => setShowDuplicate(false)}><p>Create a separate draft using the last saved settings. {dirty && 'Duplicating will discard your unsaved edits.'}</p><Field label="Copy to account"><Select aria-label="Duplicate to account" value={duplicateAccount} onChange={event => setDuplicateAccount(event.target.value)}>{accounts.map(account => <option value={account.id} key={account.id}>@{account.username}</option>)}</Select></Field><div className="dialog-actions"><Button onClick={() => setShowDuplicate(false)}>Cancel</Button><Button variant="primary" disabled={Boolean(busy)} onClick={() => void perform('duplicate', async () => { await onDuplicate(duplicateAccount); setShowDuplicate(false); })}>{busy === 'duplicate' ? <Spinner /> : <Icon icon={Copy} size={16} />}Duplicate</Button></div></Dialog>}
    {replaceTemplate && <Dialog title="Use the link template?" onClose={() => setReplaceTemplate(false)}><p>This replaces the draft conversation. Your published version stays available to conversations already running.</p><div className="dialog-actions"><Button onClick={() => setReplaceTemplate(false)}>Keep custom flow</Button><Button variant="primary" onClick={() => { const flow = starterFlow(); setCached(readTemplate(flow)); setDraft({ ...draft, flow }); setReplaceTemplate(false); }}>Use link template</Button></div></Dialog>}
  </div>;
}

function splitKeywords(value: string): string[] { return value.split(/[,\n]/).map(item => item.trim()).filter(Boolean); }

function Validation({ issues }: { issues: string[] }) {
  return <div className={`flow-validation ${issues.length ? '' : 'valid'}`} role="status"><Icon icon={issues.length ? FileText : Check} size={18} /><div><strong>{issues.length ? `${issues.length} ${issues.length === 1 ? 'check needs' : 'checks need'} attention` : 'Flow checks passed'}</strong>{issues.length ? <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <p>The flow is connected and ready for publication checks.</p>}</div></div>;
}

function TextField({ label, value, limit, onChange, single = false }: { label: string; value: string; limit: number; onChange: (value: string) => void; single?: boolean }) {
  return <Field label={label} hint={`${value.length} / ${limit} characters`}>{single ? <input aria-label={label} value={value} maxLength={limit} onChange={event => onChange(event.target.value)} /> : <textarea aria-label={label} rows={4} value={value} maxLength={Math.max(value.length, limit)} onChange={event => onChange(event.target.value)} />}</Field>;
}
