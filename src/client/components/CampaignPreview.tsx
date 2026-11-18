import { useEffect, useState } from 'react';
import { z } from 'zod';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import type { Account, CampaignInput, Media } from '../../shared/domain';
import { previewCampaign, type PreviewEvent } from './preview-model';

type PreviewView = 'Post' | 'Comments' | 'DM';
export function CampaignPreview({ draft, account, media }: { draft: CampaignInput; account?: Account; media?: Media }) {
  const [view, setView] = useState<PreviewView>('DM');
  const [events, setEvents] = useState<PreviewEvent[]>([]);
  const [answer, setAnswer] = useState('');
  const [answerError, setAnswerError] = useState('');
  const result = previewCampaign(draft, events);
  useEffect(() => {
    if (result.eventsUsed < events.length) setEvents(current => current.slice(0, result.eventsUsed));
  }, [events.length, result.eventsUsed]);
  function choose(index: number, event: PreviewEvent) {
    setEvents(current => [...current.slice(0, index), event]);
    setAnswer(''); setAnswerError('');
  }
  const postContext = <section className="preview-post" aria-label="Post preview" data-context={view === 'Comments' ? 'comments' : 'post'}>{draft.target.kind === 'all' && media && <span className="preview-post-context">Example post from this account</span>}{media?.thumbnailUrl ? <img src={media.thumbnailUrl} alt={draft.target.kind === 'all' ? 'Example post' : 'Selected post'} /> : <div className="preview-post-placeholder">{draft.target.kind === 'next' ? 'Your next post or reel' : draft.target.kind === 'all' ? 'Any post or reel' : 'Selected post or reel'}</div>}<p>{media?.caption || 'Your post caption appears here.'}</p></section>;
  return <aside className="campaign-preview card" aria-label="Campaign preview">
    <div className="campaign-preview-heading"><div><h2>Live preview</h2><p>Explore the draft. Nothing is sent.</p></div><button className="text-button" onClick={() => { setEvents([]); setAnswer(''); }}>Start over</button></div>
    <ToggleGroup.Root type="single" className="preview-switch" aria-label="Preview view" value={view} onValueChange={next => { if (next === 'Post' || next === 'Comments' || next === 'DM') setView(next); }}>{(['Post', 'Comments', 'DM'] satisfies PreviewView[]).map(option => <ToggleGroup.Item key={option} value={option}>{option}</ToggleGroup.Item>)}</ToggleGroup.Root>
    <div className="phone-preview"><div className="phone-top"><span className="avatar">{(account?.username ?? 'A').slice(0, 1).toUpperCase()}</span><div><strong>{account ? `@${account.username}` : 'Your account'}</strong><small>Instagram preview</small></div></div>
      {(view === 'Post' || view === 'Comments') && postContext}
      {view === 'Comments' && <section className="preview-comments" aria-label="Comments preview"><h3>Comments</h3><p><strong>Example comment</strong><br />{draft.matching.mode === 'any' ? 'Interested!' : draft.matching.include[0] || 'Your keyword'}</p>{draft.publicReply ? <p><strong>{account ? `@${account.username}` : 'Your account'}</strong><br />{draft.replyVariations[0] || 'Add a public reply.'}</p> : <p className="muted">Public replies are off.</p>}</section>}
      {view === 'DM' && <div className="preview-messages">{!draft.privateReply ? <p className="preview-system">Private messages are off for this campaign.</p> : result.items.map(({ node, eventIndex, waiting, linkVisited }) => {
        const visit = events[eventIndex];
        const responseIndex = visit?.kind === 'visit' && visit.nodeId === node.id ? eventIndex + 1 : eventIndex;
        const response = events[responseIndex];
        return <div key={node.id}>
        {node.kind === 'message' && <div className="preview-bubble"><p>{node.text || 'Write a message…'}</p>{node.buttons.map((button, index) => button.kind === 'reply' ? <button key={index} onClick={() => choose(responseIndex, { kind: 'reply', nodeId: node.id, index, next: button.next })}>{button.label || 'Reply'}</button> : <button key={index} onClick={() => choose(eventIndex, { kind: 'visit', nodeId: node.id, index, url: button.url })}>{button.label || 'Visit link'} <small>(simulate visit)</small></button>)}{waiting && node.buttons.every(button => button.kind !== 'reply') && <button onClick={() => choose(responseIndex, { kind: 'inbound', nodeId: node.id, value: 'Reply' })}>Simulate a reply</button>}</div>}
        {node.kind === 'message' && response?.nodeId === node.id && response.kind === 'reply' && <p className="preview-response">{node.buttons[response.index]?.label}</p>}
        {node.kind === 'message' && response?.nodeId === node.id && response.kind === 'inbound' && <p className="preview-response">{response.value}</p>}
        {node.kind === 'collect' && <div className="preview-bubble"><p>{node.prompt}</p>{waiting && <form onSubmit={event => { event.preventDefault(); if (!answer.trim() || node.field === 'email' && !z.email().safeParse(answer.trim()).success) { setAnswerError(node.field === 'email' ? 'Enter a valid email.' : 'Enter an answer.'); return; } choose(eventIndex, { kind: 'inbound', nodeId: node.id, value: answer.trim() }); }}><input aria-label={`Preview ${node.field}`} value={answer} onChange={event => setAnswer(event.target.value)} placeholder={node.field === 'email' ? 'name@example.com' : 'Your answer'} />{answerError && <small role="alert">{answerError}</small>}<button type="submit">Send reply</button></form>}</div>}
        {node.kind === 'collect' && response?.kind === 'inbound' && response.nodeId === node.id && <p className="preview-response">{response.value}</p>}
        {node.kind === 'delay' && <div className="preview-system">Wait {node.seconds} seconds.{waiting && <button onClick={() => choose(eventIndex, { kind: 'delay', nodeId: node.id, seconds: node.seconds })}>Advance time</button>}</div>}
        {node.kind === 'condition' && !(node.field === '$link_clicked' && node.operator === 'is_set') && <div className="preview-system">Condition: {node.field} {node.operator.replaceAll('_', ' ')} {node.value}{waiting && <div><button onClick={() => choose(eventIndex, { kind: 'condition', nodeId: node.id, next: node.yes })}>Yes</button><button onClick={() => choose(eventIndex, { kind: 'condition', nodeId: node.id, next: node.no })}>No</button></div>}</div>}
        {node.kind === 'condition' && node.field === '$link_clicked' && node.operator === 'is_set' && <div className="preview-system">Link visited: {linkVisited ? 'yes' : 'no'}</div>}
        {node.kind === 'action' && <div className="preview-system">Apply tag: {node.tag}</div>}
        {node.kind === 'end' && <div className="preview-system">{node.outcome === 'handoff' ? 'Hand off to a person' : 'Conversation complete'}</div>}
      </div>; })}{result.windowClosed && <p className="preview-system">The messaging window has closed, so the next message cannot be sent.</p>}</div>}
    </div>{view === 'DM' && <p className="preview-footnote">Link visits are simulated and do not count as replies.</p>}
  </aside>;
}
