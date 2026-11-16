import { z } from 'zod';

export const MESSAGE_TEXT_LIMIT = 2000;
export const BUTTON_MESSAGE_LIMIT = 640;
export const BUTTON_LABEL_LIMIT = 20;
export const MAX_MESSAGE_BUTTONS = 3;
export const MESSAGING_WINDOW_SECONDS = 24 * 60 * 60;
export const PRIVATE_REPLY_WINDOW_SECONDS = 7 * 24 * 60 * 60;
export const MAX_DELAY_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_REMINDER_SECONDS = 60 * 60;

const id = z.string().min(1).max(160);
const text = z.string().max(MESSAGE_TEXT_LIMIT);
const nullableId = id.nullable();
const replyButton = z.object({ kind: z.literal('reply'), label: z.string().min(1).max(BUTTON_LABEL_LIMIT), next: id });
const urlButton = z.object({ kind: z.literal('url'), label: z.string().min(1).max(BUTTON_LABEL_LIMIT), url: z.url().refine(value => /^https?:\/\//.test(value), 'Use an HTTP or HTTPS URL') });
export const buttonSchema = z.discriminatedUnion('kind', [replyButton, urlButton]);
export const nodeSchema = z.discriminatedUnion('kind', [
  z.object({ id, kind: z.literal('message'), text, buttons: z.array(buttonSchema).max(MAX_MESSAGE_BUTTONS), next: nullableId }),
  z.object({ id, kind: z.literal('collect'), field: z.enum(['email', 'name', 'answer']), prompt: text.min(1), next: id }),
  z.object({ id, kind: z.literal('condition'), field: z.string().min(1).max(80), operator: z.enum(['equals', 'contains', 'has_tag', 'is_set']), value: z.string().max(200), yes: id, no: id }),
  z.object({ id, kind: z.literal('action'), tag: z.string().min(1).max(80), next: id }),
  z.object({ id, kind: z.literal('delay'), seconds: z.number().int().min(1).max(MAX_DELAY_SECONDS), next: id }),
  z.object({ id, kind: z.literal('end'), outcome: z.enum(['complete', 'handoff']) }),
]);
export const flowSchema = z.object({ entry: id, nodes: z.array(nodeSchema).min(1).max(100) });
export const targetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('specific'), mediaId: id }),
  z.object({ kind: z.literal('next') }),
]);
export const campaignInputSchema = z.object({
  accountId: id,
  name: z.string().trim().min(1).max(120),
  target: targetSchema,
  matching: z.object({ mode: z.enum(['any', 'whole_word', 'phrase']), include: z.array(z.string().trim().min(1).max(80)).max(50), exclude: z.array(z.string().trim().min(1).max(80)).max(50) }),
  publicReply: z.boolean(),
  replyVariations: z.array(z.string().trim().min(1).max(500)).max(100),
  privateReply: z.boolean(),
  priority: z.number().int().min(0).max(1000),
  flow: flowSchema,
});

export type FlowNode = z.infer<typeof nodeSchema>;
export type Flow = z.infer<typeof flowSchema>;
export type CampaignInput = z.infer<typeof campaignInputSchema>;
export type Button = z.infer<typeof buttonSchema>;

export interface Account {
  id: string;
  username: string;
  name: string;
  mode: 'demo' | 'live';
  status: 'connected' | 'reconnect' | 'restricted';
  avatarUrl: string | null;
  tokenExpiresAt: number | null;
  lastSyncAt: number | null;
}
export interface Media {
  id: string;
  accountId: string;
  caption: string;
  type: 'REELS' | 'IMAGE' | 'CAROUSEL_ALBUM' | 'VIDEO';
  permalink: string | null;
  thumbnailUrl: string | null;
  publishedAt: number;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
}
export interface Campaign {
  id: string;
  accountId: string;
  name: string;
  status: 'draft' | 'live' | 'paused';
  draft: CampaignInput;
  publishedTarget: CampaignInput['target'] | null;
  liveVersionId: string | null;
  boundMediaId: string | null;
  armedAt: number | null;
  createdAt: number;
  updatedAt: number;
}
export interface Contact {
  id: string;
  accountId: string;
  instagramId: string;
  username: string;
  fields: Record<string, string>;
  tags: string[];
  lastInteractionAt: number | null;
  createdAt: number;
}
export interface Message {
  id: string;
  accountId: string;
  contactId: string;
  runId: string | null;
  direction: 'in' | 'out';
  channel: 'dm' | 'public';
  text: string;
  buttons: Button[];
  status: 'received' | 'accepted' | 'failed' | 'uncertain';
  createdAt: number;
}
export interface FlowRun {
  id: string;
  accountId: string;
  contactId: string;
  campaignId: string;
  versionId: string;
  commentId: string;
  mediaId: string;
  nodeId: string | null;
  state: 'running' | 'waiting' | 'delayed' | 'complete' | 'handoff' | 'expired' | 'failed' | 'uncertain';
  wakeAt: number | null;
  createdAt: number;
  updatedAt: number;
}
export interface Action {
  id: string;
  accountId: string;
  runId: string;
  nodeId: string;
  kind: 'public' | 'private' | 'dm';
  status: 'pending' | 'executing' | 'succeeded' | 'failed' | 'uncertain';
  text: string;
  attempts: number;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}
export interface Click {
  id: string;
  accountId: string;
  campaignId: string;
  runId: string;
  contactId: string;
  linkId: string;
  automated: boolean;
  createdAt: number;
}
export interface Metrics {
  matchedComments: number;
  openingAccepted: number;
  linkMessagesAccepted: number;
  buttonResponders: number;
  uniqueClickers: number;
  emailsCollected: number;
  completedRuns: number;
  failedActions: number;
}
export interface Configuration {
  demoEnabled: boolean;
  metaConfigured: boolean;
  publicBaseUrl: string;
  webhookUrl: string;
  callbackUrl: string;
  graphVersion: string;
  warnings: string[];
}
export interface ProcessingJob {
  id: string;
  accountId: string;
  kind: 'comment' | 'response';
  state: 'pending' | 'queued' | 'processing' | 'failed';
  attempts: number;
  error: string | null;
  availableAt: number;
  receivedAt: number;
}
export interface Bootstrap {
  accounts: Account[];
  media: Media[];
  campaigns: Campaign[];
  contacts: Contact[];
  messages: Message[];
  runs: FlowRun[];
  actions: Action[];
  clicks: Click[];
  jobs: ProcessingJob[];
  metrics: Metrics;
  configuration: Configuration;
}

export function defaultCampaign(accountId: string): CampaignInput {
  return {
    accountId, name: 'Auto-DM links from comments', target: { kind: 'all' },
    matching: { mode: 'whole_word', include: ['GUIDE'], exclude: [] },
    publicReply: true, replyVariations: ['Sent it to your inbox!', 'Check your DMs for the link.', 'Your guide is on its way.'],
    privateReply: true, priority: 100,
    flow: {
      entry: 'opening',
      nodes: [
        { id: 'opening', kind: 'message', text: 'Hey! Want the free guide?', buttons: [{ kind: 'reply', label: 'Send me the guide', next: 'resource' }], next: null },
        { id: 'resource', kind: 'message', text: 'Here is your guide. Enjoy!', buttons: [{ kind: 'url', label: 'Get the guide', url: 'https://www.notion.so/' }], next: 'done' },
        { id: 'done', kind: 'end', outcome: 'complete' },
      ],
    },
  };
}

export function nextNodes(node: FlowNode): string[] {
  switch (node.kind) {
    case 'message': return [...node.buttons.flatMap(button => button.kind === 'reply' ? [button.next] : []), ...(node.next ? [node.next] : [])];
    case 'condition': return [node.yes, node.no];
    case 'collect': case 'action': case 'delay': return [node.next];
    case 'end': return [];
  }
}

export function validateFlow(input: CampaignInput): string[] {
  const errors: string[] = [];
  const nodes = new Map(input.flow.nodes.map(node => [node.id, node]));
  if (nodes.size !== input.flow.nodes.length) errors.push('Each step needs a unique ID.');
  if (!nodes.has(input.flow.entry)) errors.push('Choose an existing opening step.');
  if (!input.publicReply && !input.privateReply) errors.push('Enable a public reply or a private message.');
  if (input.publicReply && input.replyVariations.length === 0) errors.push('Add at least one public reply.');
  if (input.matching.mode !== 'any' && input.matching.include.length === 0) errors.push('Add a keyword or choose any comment.');
  const opening = nodes.get(input.flow.entry);
  if (input.privateReply && opening?.kind !== 'message') errors.push('The first private reply must be a message.');
  for (const node of input.flow.nodes) {
    if (node.kind === 'message' && !node.text.trim()) errors.push(`Step ${node.id} needs message text.`);
    if (node.kind === 'message' && node.buttons.length && node.text.length > BUTTON_MESSAGE_LIMIT) errors.push(`Step ${node.id} must use at most ${BUTTON_MESSAGE_LIMIT} characters with buttons.`);
    if (node.kind === 'message' && node.buttons.some(button => button.kind === 'reply') && node.next) errors.push(`Step ${node.id} cannot auto-advance while waiting for a button.`);
    for (const target of nextNodes(node)) if (!nodes.has(target)) errors.push(`Step ${node.id} points to missing step ${target}.`);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(nodeId: string) {
    if (visiting.has(nodeId)) { errors.push('Cycles are not supported. Add a separate campaign for repeated journeys.'); return; }
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    const node = nodes.get(nodeId);
    if (node) nextNodes(node).forEach(visit);
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  visit(input.flow.entry);
  if (visited.size < nodes.size) errors.push('Every step must be reachable from the opening step.');
  return [...new Set(errors)];
}
