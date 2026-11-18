import { MESSAGING_WINDOW_SECONDS, type Button, type CampaignInput, type FlowNode } from '../../shared/domain';

type NodeOf<K extends FlowNode['kind']> = Extract<FlowNode, { kind: K }>;

export type PreviewChoice =
  | { kind: 'follow'; nodeId: string; following: boolean }
  | { kind: 'reply'; nodeId: string; index: number; button: Extract<Button, { kind: 'reply' }> }
  | { kind: 'visit'; nodeId: string; index: number; button: Extract<Button, { kind: 'url' }> }
  | { kind: 'condition'; nodeId: string; condition: NodeOf<'condition'>; matched: boolean };

type PreviewStep =
  | (NodeOf<'follow'> & { following: boolean })
  | (NodeOf<'message'> & { response: string | null; replyIndex: number | null; visitedIndex: number | null })
  | (NodeOf<'collect'> & { answer: string })
  | (NodeOf<'condition'> & { matched: boolean; assumed: boolean; linkVisited: boolean })
  | NodeOf<'action' | 'delay' | 'end'>;

type PreviewResult = { steps: PreviewStep[]; validChoices: PreviewChoice[]; stop: 'finished' | 'window-closed' | 'invalid-path' | 'awaiting-follow' };

const exampleAnswers = { email: 'alex@example.com', name: 'Alex', answer: 'Example answer' } satisfies Record<NodeOf<'collect'>['field'], string>;

export function previewCampaign(input: CampaignInput, choices: readonly PreviewChoice[]): PreviewResult {
  const steps: PreviewStep[] = [];
  const nodes = new Map<string, FlowNode | undefined>();
  for (const node of input.flow.nodes) nodes.set(node.id, nodes.has(node.id) ? undefined : node);
  const validChoices = choices.filter(choice => {
    const node = nodes.get(choice.nodeId);
    if (choice.kind === 'follow') return node?.kind === 'follow';
    if (choice.kind === 'condition') {
      const saved = choice.condition;
      return node?.kind === 'condition' && node.field !== '$link_clicked'
        && node.field === saved.field && node.operator === saved.operator && node.value === saved.value
        && node.yes === saved.yes && node.no === saved.no;
    }
    const button = node?.kind === 'message' ? node.buttons[choice.index] : undefined;
    if (!button || button.label !== choice.button.label) return false;
    return choice.kind === 'reply'
      ? button.kind === 'reply' && button.next === choice.button.next
      : button.kind === 'url' && button.url === choice.button.url;
  });
  if (!input.privateReply) return { steps, validChoices, stop: 'finished' };
  if (nodes.size !== input.flow.nodes.length) return { steps, validChoices, stop: 'invalid-path' };
  let id: string | null = input.flow.entry;
  let visited = false;
  let elapsed = 0;
  let engaged = false;
  const fields = new Map<string, string>();
  const tags = new Set<string>();
  const seen = new Set<string>();
  while (id) {
    const node = nodes.get(id);
    if (!node || seen.has(id)) return { steps, validChoices, stop: 'invalid-path' };
    seen.add(id);
    if ((node.kind === 'message' || node.kind === 'collect' || node.kind === 'follow') && id !== input.flow.entry && (!engaged || elapsed >= MESSAGING_WINDOW_SECONDS)) {
      return { steps, validChoices, stop: 'window-closed' };
    }
    switch (node.kind) {
      case 'message': {
        const reply = validChoices.find(choice => choice.kind === 'reply' && choice.nodeId === node.id);
        const replyIndex = reply?.kind === 'reply' ? reply.index : node.buttons.findIndex(button => button.kind === 'reply');
        const button = node.buttons[replyIndex];
        const visit = validChoices.find(choice => choice.kind === 'visit' && choice.nodeId === node.id);
        const visitedIndex = visit?.kind === 'visit' ? visit.index : null;
        if (visitedIndex !== null) visited = true;
        let response: string | null = null;
        if (button?.kind === 'reply') {
          response = button.label;
          id = button.next;
        } else {
          id = node.next;
          if (node.id === input.flow.entry && id && nodes.get(id)?.kind !== 'end') response = 'Example reply';
        }
        if (response !== null) { engaged = true; elapsed = 0; }
        steps.push({ ...node, response, replyIndex: replyIndex < 0 ? null : replyIndex, visitedIndex });
        break;
      }
      case 'follow': {
        const choice = validChoices.find(choice => choice.kind === 'follow' && choice.nodeId === node.id);
        const following = choice?.kind === 'follow' ? choice.following : true;
        steps.push({ ...node, following });
        if (!following) return { steps, validChoices, stop: 'awaiting-follow' };
        id = node.next;
        break;
      }
      case 'collect': {
        const answer = exampleAnswers[node.field];
        fields.set(node.field, answer);
        engaged = true;
        elapsed = 0;
        steps.push({ ...node, answer });
        id = node.next;
        break;
      }
      case 'condition': {
        const value = node.field === '$link_clicked' ? visited ? 'true' : '' : fields.get(node.field) ?? '';
        const choice = validChoices.find(choice => choice.kind === 'condition' && choice.nodeId === node.id);
        const assumed = choice?.kind === 'condition';
        const matched = assumed ? choice.matched
          : node.operator === 'has_tag' ? tags.has(node.value)
          : node.operator === 'is_set' ? !!value
          : node.operator === 'equals' ? value.toLocaleLowerCase() === node.value.toLocaleLowerCase()
          : value.toLocaleLowerCase().includes(node.value.toLocaleLowerCase());
        steps.push({ ...node, matched, assumed, linkVisited: visited });
        id = matched ? node.yes : node.no;
        break;
      }
      case 'delay':
        elapsed += node.seconds;
        steps.push(node);
        id = node.next;
        break;
      case 'action':
        tags.add(node.tag);
        steps.push(node);
        id = node.next;
        break;
      case 'end':
        steps.push(node);
        id = null;
        break;
      default: {
        const exhaustive: never = node;
        return exhaustive;
      }
    }
  }
  return { steps, validChoices, stop: 'finished' };
}
