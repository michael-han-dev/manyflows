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
  const postContext = <section className="preview-post" aria-label="Post preview" data-context={view === 'Comments' ? 'comments' : 'post'}>{draft.target.kind === 'all' && media && <span className="preview-post-context">Example post from this account</span>}{media?.thumbnailUrl ? <img src={media.thumbnailUrl} alt={draft.target.kind === 'all' ? 'Example post' : 'Selected post'} /> : <div className="preview-post-placeholder">{draft.target.kind === 'next' ? 'Your next post or reel' : draft.target.kind === 'all' ? 'Any post or reel' : 'Selected post or reel'}</div>}<p>{media?.caption || 'Your post caption appears here.'}</p></section>;
  return <aside className="campaign-preview card" aria-label="Campaign preview">
    <div className="campaign-preview-heading"><div><h2>Live preview</h2><p>The full example conversation. Nothing is sent.</p></div>{choices.length > 0 && <button className="text-button" onClick={() => setChoices([])}>Reset preview</button>}</div>
    <ToggleGroup.Root type="single" className="preview-switch" aria-label="Preview view" value={view} onValueChange={next => { if (next === 'Post' || next === 'Comments' || next === 'DM') setView(next); }}>{(['Post', 'Comments', 'DM'] satisfies PreviewView[]).map(option => <ToggleGroup.Item key={option} value={option}>{option}</ToggleGroup.Item>)}</ToggleGroup.Root>
    <div className="phone-preview"><div className="phone-top"><span className="avatar">{(account?.username ?? 'A').slice(0, 1).toUpperCase()}</span><div><strong>{account ? `@${account.username}` : 'Your account'}</strong><small>Instagram preview</small></div></div>
      {(view === 'Post' || view === 'Comments') && postContext}
      {view === 'Comments' && <section className="preview-comments" aria-label="Comments preview"><h3>Comments</h3><p><strong>Example comment</strong><br />{draft.matching.mode === 'any' ? 'Interested!' : draft.matching.include[0] || 'Your keyword'}</p>{draft.publicReply ? <p><strong>{account ? `@${account.username}` : 'Your account'}</strong><br />{draft.replyVariations[0] || 'Add a public reply.'}</p> : <p className="muted">Public replies are off.</p>}</section>}
      {view === 'DM' && <div className="preview-messages">{!draft.privateReply ? <p className="preview-system">Private messages are off for this campaign.</p> : result.steps.map(step => <div key={step.id}>
        {step.kind === 'message' && <>
          <div className="preview-bubble"><p>{step.text || 'Write a message…'}</p>{step.buttons.map((button, index) => button.kind === 'reply'
            ? <button key={index} aria-pressed={step.replyIndex === index} onClick={() => choose({ kind: 'reply', nodeId: step.id, index, button })}>{button.label || 'Reply'}</button>
            : <button key={index} aria-pressed={step.visitedIndex === index} onClick={() => toggleVisit({ kind: 'visit', nodeId: step.id, index, button }, step.visitedIndex === index)}>{button.label || 'Visit link'} <small>({step.visitedIndex === index ? 'visited' : 'simulate visit'})</small></button>)}</div>
          {step.response !== null && <p className="preview-response">{step.response}</p>}
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
