import { defaultCampaign, DEFAULT_REMINDER_SECONDS, MAX_MESSAGE_BUTTONS, type Button, type Flow, type FlowNode, upgradeLegacyFollowFlow } from '../../shared/domain';

type UrlButton = Extract<Button, { kind: 'url' }>;
export type TemplateModel = {
  opening: boolean; openingText: string; openingButton: string;
  email: boolean; emailPrompt: string;
  follow: boolean; followText: string; followButton: string;
  resourceText: string; resourceLinks: UrlButton[];
  reminder: boolean; reminderText: string; reminderSeconds: number;
};

const defaults: TemplateModel = {
  opening: false, openingText: 'Hi! Would you like the resource?', openingButton: 'Send it to me',
  email: false, emailPrompt: 'What is your email address?',
  follow: false, followText: 'Follow our account, then let us know when you are ready.', followButton: 'I followed',
  resourceText: '', resourceLinks: [], reminder: false,
  reminderText: 'Just a reminder to take a look when you have a moment.', reminderSeconds: DEFAULT_REMINDER_SECONDS,
};

function sameStoredValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => sameStoredValue(item, right[index]));
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) || Array.isArray(right)) return false;
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return sameStoredValue(leftEntries, rightEntries);
}

export function readTemplate(stored: Flow): TemplateModel | null {
  const flow = upgradeLegacyFollowFlow(stored);
  const byId = new Map(flow.nodes.map(node => [node.id, node]));
  if (byId.size !== flow.nodes.length) return null;
  const opening = byId.get('opening');
  const email = byId.get('email');
  const follow = byId.get('follow');
  const resource = byId.get('resource');
  const delay = byId.get('reminder_delay');
  const reminder = byId.get('reminder');
  if (resource?.kind !== 'message' || resource.buttons.length > MAX_MESSAGE_BUTTONS || resource.buttons.some(button => button.kind !== 'url')) return null;
  const resourceLinks = resource.buttons.filter((button): button is UrlButton => button.kind === 'url');
  const openingButton = opening?.kind === 'message' ? opening.buttons[0] : undefined;
  if (opening && (opening.kind !== 'message' || openingButton?.kind !== 'reply')) return null;
  if (email && email.kind !== 'collect') return null;
  if (follow && follow.kind !== 'follow') return null;
  if (delay && delay.kind !== 'delay') return null;
  if (reminder && reminder.kind !== 'message') return null;
  const model: TemplateModel = {
    ...defaults,
    opening: Boolean(opening), openingText: opening?.kind === 'message' ? opening.text : defaults.openingText,
    openingButton: openingButton?.kind === 'reply' ? openingButton.label : defaults.openingButton,
    email: Boolean(email), emailPrompt: email?.kind === 'collect' ? email.prompt : defaults.emailPrompt,
    follow: Boolean(follow), followText: follow?.kind === 'follow' ? follow.text : defaults.followText,
    followButton: follow?.kind === 'follow' ? follow.buttonLabel : defaults.followButton,
    resourceText: resource.text, resourceLinks,
    reminder: Boolean(delay), reminderText: reminder?.kind === 'message' ? reminder.text : defaults.reminderText,
    reminderSeconds: delay?.kind === 'delay' ? delay.seconds : defaults.reminderSeconds,
  };
  const written = writeTemplate(model);
  if (!sameStoredValue(flow.entry, written.entry) || flow.nodes.length !== written.nodes.length) return null;
  if (!written.nodes.every(node => sameStoredValue(byId.get(node.id), node))) return null;
  const flowKeys = Object.keys(flow).sort();
  if (!sameStoredValue(flowKeys, ['entry', 'nodes'])) return null;
  return model;
}

export function writeTemplate(model: TemplateModel): Flow {
  const nodes: FlowNode[] = [];
  if (model.opening) nodes.push({ id: 'opening', kind: 'message', text: model.openingText, buttons: [{ kind: 'reply', label: model.openingButton, next: model.email ? 'email' : model.follow ? 'follow' : 'resource' }], next: null });
  if (model.opening && model.email) nodes.push({ id: 'email', kind: 'collect', field: 'email', prompt: model.emailPrompt, next: model.follow ? 'follow' : 'resource' });
  if (model.opening && model.follow) nodes.push({ id: 'follow', kind: 'follow', text: model.followText, buttonLabel: model.followButton, next: 'resource' });
  nodes.push({ id: 'resource', kind: 'message', text: model.resourceText, buttons: model.resourceLinks, next: model.opening && model.reminder ? 'reminder_delay' : 'done' });
  if (model.opening && model.reminder) {
    nodes.push({ id: 'reminder_delay', kind: 'delay', seconds: model.reminderSeconds, next: 'reminder_check' });
    nodes.push({ id: 'reminder_check', kind: 'condition', field: '$link_clicked', operator: 'is_set', value: '', yes: 'done', no: 'reminder' });
    nodes.push({ id: 'reminder', kind: 'message', text: model.reminderText, buttons: [], next: 'done' });
  }
  nodes.push({ id: 'done', kind: 'end', outcome: 'complete' });
  return { entry: model.opening ? 'opening' : 'resource', nodes };
}

export function starterFlow(): Flow { return defaultCampaign('').flow; }
