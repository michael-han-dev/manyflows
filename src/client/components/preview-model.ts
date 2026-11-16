import { z } from 'zod';
import { MESSAGING_WINDOW_SECONDS, type CampaignInput, type FlowNode } from '../../shared/domain';

export type PreviewEvent =
  | { kind: 'reply'; nodeId: string; index: number; next: string }
  | { kind: 'inbound'; nodeId: string; value: string }
  | { kind: 'visit'; nodeId: string; index: number; url: string }
  | { kind: 'delay'; nodeId: string; seconds: number }
  | { kind: 'condition'; nodeId: string; next: string };

export type PreviewItem = { node: FlowNode; eventIndex: number; waiting: boolean; linkVisited: boolean };
export type PreviewResult = { items: PreviewItem[]; eventsUsed: number; visited: boolean; windowClosed: boolean };

export function previewCampaign(input: CampaignInput, events: PreviewEvent[]): PreviewResult {
  const items: PreviewItem[] = [];
  if (!input.privateReply) return { items, eventsUsed: 0, visited: false, windowClosed: false };
  let id: string | null = input.flow.entry;
  let index = 0;
  let visited = false;
  let elapsed = 0;
  let engaged = false;
  let windowClosed = false;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    const node: FlowNode | undefined = input.flow.nodes.find(item => item.id === id);
    if (!node) break;
    seen.add(id);
    const eventIndex = index;
    let waiting = false;
    let next: string | null = null;
    if ((node.kind === 'message' || node.kind === 'collect') && id !== input.flow.entry && (!engaged || elapsed >= MESSAGING_WINDOW_SECONDS)) {
      windowClosed = true;
      break;
    }
    switch (node.kind) {
      case 'message': {
        const event = events[index];
        if (event?.kind === 'visit' && event.nodeId === node.id) {
          const button = node.buttons[event.index];
          if (button?.kind === 'url' && button.url === event.url) { visited = true; index++; }
        }
        const replies = node.buttons.filter(button => button.kind === 'reply');
        const response = events[index];
        if (replies.length) {
          const selected = response?.kind === 'reply' ? node.buttons[response.index] : undefined;
          if (response?.kind === 'reply' && response.nodeId === node.id && selected?.kind === 'reply' && selected.next === response.next) {
            next = response.next; index++; engaged = true; elapsed = 0;
          } else waiting = true;
        } else if (node.id === input.flow.entry && node.next && input.flow.nodes.find(item => item.id === node.next)?.kind !== 'end') {
          if (response?.kind === 'inbound' && response.nodeId === node.id && response.value.trim()) {
            next = node.next; index++; engaged = true; elapsed = 0;
          } else waiting = true;
        } else next = node.next;
        break;
      }
      case 'collect': {
        const event = events[index];
        if (event?.kind === 'inbound' && event.nodeId === node.id && event.value.trim() && (node.field !== 'email' || z.email().safeParse(event.value.trim()).success)) {
          next = node.next; index++; engaged = true; elapsed = 0;
        } else waiting = true;
        break;
      }
      case 'delay': {
        const event = events[index];
        if (event?.kind === 'delay' && event.nodeId === node.id && event.seconds === node.seconds) { next = node.next; index++; elapsed += node.seconds; }
        else waiting = true;
        break;
      }
      case 'condition': {
        if (node.field === '$link_clicked' && node.operator === 'is_set') next = visited ? node.yes : node.no;
        else {
          const event = events[index];
          if (event?.kind === 'condition' && event.nodeId === node.id && (event.next === node.yes || event.next === node.no)) { next = event.next; index++; }
          else waiting = true;
        }
        break;
      }
      case 'action': next = node.next; break;
      case 'end': break;
    }
    items.push({ node, eventIndex, waiting, linkVisited: visited });
    if (waiting) break;
    id = next;
  }
  return { items, eventsUsed: index, visited, windowClosed };
}
