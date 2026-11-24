import { useState } from 'react';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import type { Account, CampaignInput, Media } from '../../shared/domain';
import { previewCampaign, type PreviewChoice } from './preview-model';

type PreviewView = 'Post' | 'Comments' | 'DM';
export function CampaignPreview({ draft, account, media }: { draft: CampaignInput; account?: Account; media?: Media }) {
  const [view, setView] = useState<PreviewView>('DM');
  const [choices, setChoices] = useState<PreviewChoice[]>([]);
  const result = previewCampaign(draft, choices);
  if (result.validChoices.length < choices.length) setChoices(result.validChoices);
  function choose(choice: PreviewChoice) {
    setChoices(current => [...current.filter(previous => previous.nodeId !== choice.nodeId || previous.kind !== choice.kind), choice]);
  }
  function toggleVisit(choice: Extract<PreviewChoice, { kind: 'visit' }>, selected: boolean) {
    if (selected) setChoices(current => current.filter(previous => previous.nodeId !== choice.nodeId || previous.kind !== 'visit'));
    else choose(choice);
  }
  return <aside className="campaign-preview card" aria-label="Campaign preview">
    <div className="campaign-preview-heading"><div><h2>Live preview</h2><p>The full example conversation. Nothing is sent.</p></div>{choices.length > 0 && <button className="text-button" onClick={() => setChoices([])}>Reset preview</button>}</div>
    <ToggleGroup.Root type="single" className="preview-switch" aria-label="Preview view" value={view} onValueChange={next => { if (next === 'Post' || next === 'Comments' || next === 'DM') setView(next); }}>{(['Post', 'Comments', 'DM'] satisfies PreviewView[]).map(option => <ToggleGroup.Item key={option} value={option}>{option}</ToggleGroup.Item>)}</ToggleGroup.Root>
    <div className="phone-preview"><div className="phone-top"><span className="avatar">{(account?.username ?? 'A').slice(0, 1).toUpperCase()}</span><div><strong>{account ? `@${account.username}` : 'Your account'}</strong><small>Instagram preview</small></div></div>
      {(view !== 'DM' || draft.target.kind === 'specific') && <PreviewPost
        key={media?.thumbnailUrl ?? media?.id}
        target={draft.target.kind} media={media} compact={view === 'DM'}
      />}
      {view === 'Comments' && <section className="preview-comments" aria-label="Comments preview"><h3>Comments</h3><p><strong>Example comment</strong><br />{draft.matching.mode === 'any' ? 'Interested!' : draft.matching.include[0] || 'Your keyword'}</p>{draft.publicReply ? <p><strong>{account ? `@${account.username}` : 'Your account'}</strong><br />{draft.replyVariations[0] || 'Add a public reply.'}</p> : <p className="muted">Public replies are off.</p>}</section>}
      {view === 'DM' && <div className="preview-messages">{!draft.privateReply ? <p className="preview-system">Private messages are off for this campaign.</p> : result.steps.map(step => <div key={step.id}>
        {step.kind === 'message' && <>
          <div className="preview-bubble"><p>{step.text || 'Write a message…'}</p>{step.buttons.map((button, index) => button.kind === 'reply'
            ? <button key={index} aria-pressed={step.replyIndex === index} onClick={() => choose({ kind: 'reply', nodeId: step.id, index, button })}>{button.label || 'Reply'}</button>
            : <button key={index} aria-pressed={step.visitedIndex === index} onClick={() => toggleVisit({ kind: 'visit', nodeId: step.id, index, button }, step.visitedIndex === index)}>{button.label || 'Visit link'} <small>({step.visitedIndex === index ? 'visited' : 'simulate visit'})</small></button>)}</div>
          {step.response !== null && <p className="preview-response">{step.response}</p>}
        </>}
        {step.kind === 'follow' && <>
          <div className="preview-system"><span>Instagram follow check</span><div className="preview-condition-result" role="group" aria-label="Example follow status"><button aria-pressed={step.following} onClick={() => choose({ kind: 'follow', nodeId: step.id, following: true })}>Following</button><button aria-pressed={!step.following} onClick={() => choose({ kind: 'follow', nodeId: step.id, following: false })}>Not following</button></div></div>
          {step.following ? <p className="preview-system">Follow verified. Continue to the resource.</p> : <><div className="preview-bubble"><p>{step.text}</p><button onClick={() => choose({ kind: 'follow', nodeId: step.id, following: false })}>{step.buttonLabel}</button></div><p className="preview-system">Still not following. Each tap repeats this prompt until the follow is verified.</p></>}
        </>}
        {step.kind === 'collect' && <><div className="preview-bubble"><p>{step.prompt}</p></div><p className="preview-response">{step.answer}</p></>}
        {step.kind === 'delay' && <div className="preview-system">After {step.seconds} seconds</div>}
        {step.kind === 'condition' && (step.field === '$link_clicked'
          ? <div className="preview-system">
              <span>Link visited: {step.linkVisited ? 'yes' : 'no'}</span>
              {step.operator !== 'is_set' && <div>Link condition: {step.operator.replaceAll('_', ' ')} {step.value} — {step.matched ? 'Yes' : 'No'}</div>}
            </div>
          : <div className="preview-system"><span>Condition: {step.field} {step.operator.replaceAll('_', ' ')} {step.value}</span><div className="preview-condition-result" role="group" aria-label={`Example result for ${step.field}`}><span>{step.assumed ? 'Assumed result: ' : 'Example result: '}</span><button aria-pressed={step.matched} onClick={() => choose({ kind: 'condition', nodeId: step.id, condition: step, matched: true })}>Yes</button><button aria-pressed={!step.matched} onClick={() => choose({ kind: 'condition', nodeId: step.id, condition: step, matched: false })}>No</button></div></div>)}
        {step.kind === 'action' && <div className="preview-system">Apply tag: {step.tag}</div>}
        {step.kind === 'end' && <div className="preview-system">{step.outcome === 'handoff' ? 'Hand off to a person' : 'Conversation complete'}</div>}
      </div>)}{result.stop === 'window-closed' && <p className="preview-system">The messaging window has closed, so the next message cannot be sent.</p>}{result.stop === 'invalid-path' && <p className="preview-system">The preview stopped because the flow has a missing, repeated, or duplicate step.</p>}</div>}
    </div>{view === 'DM' && <p className="preview-footnote">Replies are automatic. Buttons explore other paths.</p>}
  </aside>;
}

function PreviewPost({ target, media, compact }: {
  target: CampaignInput['target']['kind'];
  media?: Media;
  compact: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const isReel = media?.type === 'REELS';
  const label = target === 'all' ? 'Example post from this account' : isReel ? 'Selected reel' : 'Selected post';
  const fallback = target === 'next' ? 'Your next post or reel' : target === 'all' ? 'Any post or reel' : 'Image unavailable';

  return <section className={compact ? 'preview-post preview-attachment' : 'preview-post'} aria-label="Post preview">
    {media?.thumbnailUrl && !imageFailed
      ? <img src={media.thumbnailUrl} alt={label} onError={() => setImageFailed(true)} />
      : <div className="preview-post-placeholder">{fallback}</div>}
    <div className="preview-post-description">
      {media && <strong>{label}</strong>}
      {media?.caption && <p>{media.caption}</p>}
    </div>
  </section>;
}
