import { defaultCampaign, type Flow, type FlowNode } from '../../shared/domain';

export type TemplateModel = {
  opening: boolean; openingText: string; openingButton: string;
  resourceText: string; resourceLabel: string; resourceUrl: string;
  email: boolean; emailPrompt: string; reminder: boolean; reminderText: string; reminderSeconds: number;
};

export function readTemplate(flow: Flow): TemplateModel | null {
  const opening = flow.nodes.find(node => node.id === 'opening');
  const resource = flow.nodes.find(node => node.id === 'resource');
  const email = flow.nodes.find(node => node.id === 'email');
  const delay = flow.nodes.find(node => node.id === 'reminder_delay');
  const reminder = flow.nodes.find(node => node.id === 'reminder');
  const done = flow.nodes.find(node => node.id === 'done');
  const allowed = new Set(['opening', 'resource', 'email', 'reminder_delay', 'reminder', 'done']);
  if (flow.nodes.some(node => !allowed.has(node.id)) || resource?.kind !== 'message' || done?.kind !== 'end' || done.outcome !== 'complete') return null;
  const link = resource.buttons[0];
  if (resource.buttons.length !== 1 || link?.kind !== 'url') return null;
  if (opening && (opening.kind !== 'message' || opening.buttons.length !== 1 || opening.buttons[0]?.kind !== 'reply' || opening.next !== null)) return null;
  if (email && (email.kind !== 'collect' || email.field !== 'email' || email.next !== 'resource' || !opening)) return null;
  if (opening?.kind === 'message' && opening.buttons[0]?.kind === 'reply' && opening.buttons[0].next !== (email ? 'email' : 'resource')) return null;
  if (flow.entry !== (opening ? 'opening' : 'resource')) return null;
  if ((delay || reminder) && (!opening || delay?.kind !== 'delay' || reminder?.kind !== 'message' || delay.next !== 'reminder' || reminder.next !== 'done' || reminder.buttons.length !== 0)) return null;
  if (resource.next !== (delay ? 'reminder_delay' : 'done')) return null;
  return {
    opening: Boolean(opening), openingText: opening?.kind === 'message' ? opening.text : 'Hey! Want the free guide?', openingButton: opening?.kind === 'message' ? opening.buttons[0]?.label ?? 'Send me the guide' : 'Send me the guide',
    resourceText: resource.text, resourceLabel: link.label, resourceUrl: link.url,
    email: Boolean(email), emailPrompt: email?.kind === 'collect' ? email.prompt : 'Where should I send future resources? Reply with your email.',
    reminder: Boolean(delay), reminderText: reminder?.kind === 'message' ? reminder.text : 'A quick reminder to check out your guide. Hope it helps!', reminderSeconds: delay?.kind === 'delay' ? delay.seconds : 3600,
  };
}

export function writeTemplate(model: TemplateModel): Flow {
  const nodes: FlowNode[] = [];
  if (model.opening) nodes.push({ id: 'opening', kind: 'message', text: model.openingText, buttons: [{ kind: 'reply', label: model.openingButton, next: model.email ? 'email' : 'resource' }], next: null });
  if (model.opening && model.email) nodes.push({ id: 'email', kind: 'collect', field: 'email', prompt: model.emailPrompt, next: 'resource' });
  nodes.push({ id: 'resource', kind: 'message', text: model.resourceText, buttons: [{ kind: 'url', label: model.resourceLabel, url: model.resourceUrl }], next: model.opening && model.reminder ? 'reminder_delay' : 'done' });
  if (model.opening && model.reminder) {
    nodes.push({ id: 'reminder_delay', kind: 'delay', seconds: model.reminderSeconds, next: 'reminder' });
    nodes.push({ id: 'reminder', kind: 'message', text: model.reminderText, buttons: [], next: 'done' });
  }
  nodes.push({ id: 'done', kind: 'end', outcome: 'complete' });
  return { entry: model.opening ? 'opening' : 'resource', nodes };
}

export function starterFlow(): Flow { return defaultCampaign('').flow; }

export function newStep(kind: FlowNode['kind'], id: string, destination: string): FlowNode {
  switch (kind) {
    case 'message': return { id, kind, text: 'Your message', buttons: [], next: destination };
    case 'collect': return { id, kind, field: 'email', prompt: 'What is your email address?', next: destination };
    case 'condition': return { id, kind, field: 'email', operator: 'is_set', value: '', yes: destination, no: destination };
    case 'action': return { id, kind, tag: 'interested', next: destination };
    case 'delay': return { id, kind, seconds: 3600, next: destination };
    case 'end': return { id, kind, outcome: 'complete' };
  }
}

export function redirectStep(node: FlowNode, from: string, to: string | null): FlowNode {
  switch (node.kind) {
    case 'message': return { ...node, next: node.next === from ? to : node.next, buttons: node.buttons.filter(button => button.kind !== 'reply' || button.next !== from || to !== null).map(button => button.kind === 'reply' && button.next === from && to ? { ...button, next: to } : button) };
    case 'condition': return { ...node, yes: node.yes === from ? to ?? '' : node.yes, no: node.no === from ? to ?? '' : node.no };
    case 'collect': case 'action': case 'delay': return { ...node, next: node.next === from ? to ?? '' : node.next };
    case 'end': return node;
  }
}
