import { useState } from 'react';
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Connection, type Edge, type Node, type NodeProps, type XYPosition } from '@xyflow/react';
import { QuestionMarkCircledIcon as CircleHelp, ClockIcon as Clock3, StopIcon as Flag, Share1Icon as GitBranch, EnvelopeClosedIcon as Mail, ChatBubbleIcon as MessageCircle, PlusIcon as Plus, BookmarkIcon as Tag, TrashIcon as Trash2, Cross2Icon as X } from '@radix-ui/react-icons';
import { nextNodes, type Flow, type FlowNode } from '../../shared/domain';
import { Select, Button, IconButton, Field, Icon , type AppIcon  } from './ui';
import { newStep, redirectStep } from './flow-model';

type GraphNode = Node<{ step: FlowNode; entry: boolean }, 'relay'>;
const nodeIcons: Record<FlowNode['kind'], AppIcon> = { message: MessageCircle, collect: Mail, condition: GitBranch, action: Tag, delay: Clock3, end: Flag };
const labels: Record<FlowNode['kind'], string> = { message: 'Message', collect: 'Collect an answer', condition: 'Condition', action: 'Apply a tag', delay: 'Delay', end: 'End / handoff' };

function stepSummary(step: FlowNode): string {
  switch (step.kind) {
    case 'message': return step.text || 'Empty message';
    case 'collect': return step.prompt;
    case 'condition': return step.field === '$link_clicked' ? 'Has the resource link been visited?' : `${step.field} ${step.operator.replaceAll('_', ' ')} ${step.value}`;
    case 'action': return step.tag || 'Choose a tag';
    case 'delay': return `Wait ${step.seconds >= 3600 ? `${(step.seconds / 3600).toFixed(1)} hours` : `${step.seconds} seconds`}`;
    case 'end': return step.outcome === 'handoff' ? 'Hand off to a person' : 'Complete the conversation';
  }
}

function StepCard({ data, selected }: NodeProps<GraphNode>) {
  const step = data.step;
  const outputs: { id: string; label: string }[] = step.kind === 'message'
    ? step.buttons.flatMap((button, index) => button.kind === 'reply' ? [{ id: `reply-${index}`, label: button.label }] : []).concat(step.buttons.some(button => button.kind === 'reply') ? [] : [{ id: 'next', label: 'Continue' }])
    : step.kind === 'condition' ? [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }]
    : step.kind === 'end' ? [] : [{ id: 'next', label: 'Continue' }];
  return <div className={`flow-step flow-${step.kind} ${selected ? 'selected' : ''}`}><Handle type="target" position={Position.Top} /><div className="flow-step-head"><Icon icon={nodeIcons[step.kind]} size={16} /><strong>{labels[step.kind]}</strong>{data.entry && <span>ENTRY</span>}</div><p>{stepSummary(step)}</p><small title={step.id}>{step.id}</small>{outputs.map((output, index) => <div className="flow-port" key={output.id} style={{ left: `${(index + 1) / (outputs.length + 1) * 100}%`, width: `${100 / (outputs.length + 1)}%` }}><span title={output.label}>{output.label}</span><Handle id={output.id} type="source" position={Position.Bottom} /></div>)}</div>;
}

const nodeTypes = { relay: StepCard };

function graphEdges(flow: Flow): Edge[] {
  return flow.nodes.flatMap(node => {
    const links: { target: string; handle: string; label?: string }[] = node.kind === 'message'
      ? [...node.buttons.flatMap((button, index) => button.kind === 'reply' ? [{ target: button.next, handle: `reply-${index}`, label: button.label }] : []), ...(node.next ? [{ target: node.next, handle: 'next' }] : [])]
      : node.kind === 'condition' ? [{ target: node.yes, handle: 'yes', label: 'Yes' }, { target: node.no, handle: 'no', label: 'No' }]
      : node.kind === 'end' ? [] : [{ target: node.next, handle: 'next' }];
    return links.filter(link => link.target).map(link => ({ id: `${node.id}:${link.handle}`, source: node.id, target: link.target, sourceHandle: link.handle, label: link.label, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--primary)' }, style: { stroke: 'var(--primary)', strokeWidth: 1.5 } }));
  });
}

function initialPositions(flow: Flow): Map<string, XYPosition> {
  const levels = new Map<string, number>();
  const visit = (id: string, depth: number, path: Set<string>) => {
    if (path.has(id) || depth > 100) return;
    if ((levels.get(id) ?? -1) >= depth) return;
    levels.set(id, depth);
    const node = flow.nodes.find(step => step.id === id);
    if (node) nextNodes(node).forEach(next => visit(next, depth + 1, new Set([...path, id])));
  };
  visit(flow.entry, 0, new Set());
  const rows = new Map<number, number>();
  return new Map(flow.nodes.map(node => {
    const level = levels.get(node.id) ?? 0;
    const column = rows.get(level) ?? 0; rows.set(level, column + 1);
    return [node.id, { x: column * 300 + 50, y: level * 225 + 40 }];
  }));
}

export function FlowEditor({ flow, onChange }: { flow: Flow; onChange: (flow: Flow) => void }) {
  const [selectedId, setSelectedId] = useState(flow.entry);
  const [positions, setPositions] = useState<Map<string, XYPosition>>(() => new Map());
  const [kind, setKind] = useState<FlowNode['kind']>('message');
  const selected = flow.nodes.find(node => node.id === selectedId);
  const layout = initialPositions(flow);
  const nodes: GraphNode[] = flow.nodes.map(step => ({ id: step.id, type: 'relay', data: { step, entry: step.id === flow.entry }, position: positions.get(step.id) ?? layout.get(step.id) ?? { x: 50, y: 50 }, selected: step.id === selectedId }));
  const changeNode = (updated: FlowNode) => onChange({ ...flow, nodes: flow.nodes.map(node => node.id === updated.id ? updated : node) });

  function connect(connection: Connection) {
    const node = flow.nodes.find(step => step.id === connection.source);
    if (!node || !connection.target || connection.target === node.id) return;
    const target = connection.target;
    const handle = connection.sourceHandle;
    switch (node.kind) {
      case 'message': {
        if (handle?.startsWith('reply-')) {
          const index = Number(handle.slice(6));
          changeNode({ ...node, buttons: node.buttons.map((button, buttonIndex) => button.kind === 'reply' && buttonIndex === index ? { ...button, next: target } : button) });
        } else changeNode({ ...node, next: target });
        break;
      }
      case 'condition': changeNode(handle === 'yes' ? { ...node, yes: target } : { ...node, no: target }); break;
      case 'collect': case 'action': case 'delay': changeNode({ ...node, next: target }); break;
      case 'end': break;
    }
  }

  function addStep() {
    let index = 1; while (flow.nodes.some(node => node.id === `${kind}_${index}`)) index++;
    const id = `${kind}_${index}`;
    const end = flow.nodes.find(node => node.kind === 'end');
    const node = newStep(kind, id, end?.id ?? flow.entry);
    onChange({ ...flow, nodes: [...flow.nodes, node] }); setSelectedId(id);
  }

  function deleteStep() {
    if (!selected || flow.nodes.length <= 1) return;
    const destination = nextNodes(selected).find(id => id !== selected.id) ?? null;
    const remaining = flow.nodes.filter(node => node.id !== selected.id);
    onChange({ entry: flow.entry === selected.id ? destination ?? remaining[0]?.id ?? '' : flow.entry, nodes: remaining.map(node => redirectStep(node, selected.id, destination)) });
    setSelectedId(remaining[0]?.id ?? '');
  }

  return <div className="visual-editor"><div className="flow-toolbar"><div><Icon icon={GitBranch} /><strong>Conversation canvas</strong><span>Connect handles to choose the next step.</span></div><div className="inline"><Select aria-label="New step type" value={kind} onChange={event => { const value = event.target.value; if (value === 'message' || value === 'collect' || value === 'condition' || value === 'action' || value === 'delay' || value === 'end') setKind(value); }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select><Button size="small" onClick={addStep}><Icon icon={Plus} size={15} />Add step</Button></div></div><div className="flow-workspace"><div className="flow-canvas" aria-label="Visual conversation flow"><ReactFlow<GraphNode> colorMode="dark" nodes={nodes} edges={graphEdges(flow)} nodeTypes={nodeTypes} onConnect={connect} onNodeClick={(_, node) => setSelectedId(node.id)} onNodeDragStop={(_, node) => setPositions(current => new Map(current).set(node.id, node.position))} onNodesChange={changes => { const selected = changes.find(change => change.type === 'select' && change.selected); if (selected?.type === 'select') setSelectedId(selected.id); const moves = changes.filter(change => change.type === 'position' && change.position); if (moves.length) setPositions(current => { const next = new Map(current); for (const move of moves) if (move.type === 'position' && move.position) next.set(move.id, move.position); return next; }); }} fitView minZoom={0.25} maxZoom={1.5} deleteKeyCode={null} proOptions={{ hideAttribution: true }}><Background color="var(--border)" gap={20} /><Controls showInteractive={false} /></ReactFlow></div><aside className="step-inspector"><div className="inspector-title"><h3>{selected ? labels[selected.kind] : 'Select a step'}</h3>{selected && <IconButton className="danger" aria-label="Delete step" onClick={deleteStep} disabled={flow.nodes.length <= 1}><Icon icon={Trash2} size={16} /></IconButton>}</div><Field label="Opening step"><Select aria-label="Opening step" value={flow.entry} onChange={event => onChange({ ...flow, entry: event.target.value })}>{flow.nodes.map(node => <option key={node.id} value={node.id}>{node.id}</option>)}</Select></Field>{selected ? <StepInspector step={selected} nodes={flow.nodes} onChange={changeNode} /> : <p className="muted">Choose a step on the canvas to edit its message or behavior.</p>}<p className="field-hint inspector-help"><Icon icon={CircleHelp} size={14} />New steps must be connected before publishing. Button replies and website visits are different actions.</p></aside></div></div>;
}

function Destination({ label = 'Next step', value, nodes, onChange, optional = false }: { label?: string; value: string | null; nodes: FlowNode[]; onChange: (value: string) => void; optional?: boolean }) {
  return <Field label={label}><Select aria-label={label} value={value ?? ''} onChange={event => onChange(event.target.value)}><option value="">{optional ? 'Stop after sending' : 'Choose a step'}</option>{nodes.map(node => <option value={node.id} key={node.id}>{node.id}</option>)}</Select></Field>;
}

function StepInspector({ step, nodes, onChange }: { step: FlowNode; nodes: FlowNode[]; onChange: (step: FlowNode) => void }) {
  const destinations = nodes.filter(node => node.id !== step.id);
  switch (step.kind) {
    case 'message': return <><Field label="Message text"><textarea aria-label="Message text" value={step.text} maxLength={2000} rows={5} onChange={event => onChange({ ...step, text: event.target.value })} /></Field><div className="section-label"><strong>Buttons</strong><span>{step.buttons.length}/3</span></div>{step.buttons.map((button, index) => <div className="button-editor" key={index}><div className="inline between"><Select aria-label={`Button ${index + 1} type`} value={button.kind} onChange={event => onChange({ ...step, next: event.target.value === 'reply' ? null : step.next, buttons: step.buttons.map((existing, i) => i !== index ? existing : event.target.value === 'reply' ? { kind: 'reply', label: existing.label, next: destinations[0]?.id ?? '' } : { kind: 'url', label: existing.label, url: 'https://' }) })}><option value="reply">Response button</option><option value="url">Website button</option></Select><IconButton className="danger" aria-label={`Remove button ${index + 1}`} onClick={() => onChange({ ...step, buttons: step.buttons.filter((_, i) => i !== index) })}><Icon icon={X} size={15} /></IconButton></div><Field label="Button label"><input aria-label={`Button ${index + 1} label`} value={button.label} maxLength={20} onChange={event => onChange({ ...step, buttons: step.buttons.map((existing, i) => i === index ? { ...existing, label: event.target.value } : existing) })} /></Field>{button.kind === 'url' ? <Field label="Destination URL"><input aria-label={`Button ${index + 1} URL`} type="url" value={button.url} onChange={event => onChange({ ...step, buttons: step.buttons.map((existing, i) => i === index ? { ...existing, url: event.target.value } : existing) })} /></Field> : <Destination label={`Button ${index + 1} next step`} value={button.next} nodes={destinations} onChange={value => onChange({ ...step, buttons: step.buttons.map((existing, i) => i === index && existing.kind === 'reply' ? { ...existing, next: value } : existing) })} />}</div>)}{step.buttons.length < 3 && <div className="inline wrap"><Button size="small" onClick={() => onChange({ ...step, next: null, buttons: [...step.buttons, { kind: 'reply', label: 'Continue', next: destinations[0]?.id ?? '' }] })}><Icon icon={Plus} size={14} />Response</Button><Button size="small" onClick={() => onChange({ ...step, buttons: [...step.buttons, { kind: 'url', label: 'Open resource', url: 'https://' }] })}><Icon icon={Plus} size={14} />Website</Button></div>}{!step.buttons.some(button => button.kind === 'reply') && <Destination optional value={step.next} nodes={destinations} onChange={value => onChange({ ...step, next: value || null })} />}</>;
    case 'collect': return <><Field label="Save response as"><Select aria-label="Save response as" value={step.field} onChange={event => { const field = event.target.value; if (field === 'email' || field === 'name' || field === 'answer') onChange({ ...step, field }); }}><option value="email">Email address</option><option value="name">Name</option><option value="answer">Answer</option></Select></Field><Field label="Question"><textarea aria-label="Collection question" rows={4} value={step.prompt} onChange={event => onChange({ ...step, prompt: event.target.value })} /></Field><Destination value={step.next} nodes={destinations} onChange={next => onChange({ ...step, next })} /><p className="field-hint">Email answers are validated before the flow continues.</p></>;
    case 'condition': return <><Field label="Check"><Select aria-label="Condition source" value={step.field === '$link_clicked' ? 'link_clicked' : 'contact_field'} onChange={event => onChange({ ...step, field: event.target.value === 'link_clicked' ? '$link_clicked' : 'email', operator: 'is_set', value: '' })}><option value="contact_field">Contact field</option><option value="link_clicked">Resource link visited</option></Select></Field>{step.field === '$link_clicked' ? <div className="note">Yes when a non-automated resource-link visit is recorded for this journey. A visit does not open the Instagram messaging window.</div> : <><Field label="Contact field"><input aria-label="Condition field" value={step.field} onChange={event => onChange({ ...step, field: event.target.value })} /></Field><Field label="Match"><Select aria-label="Condition operator" value={step.operator} onChange={event => { const operator = event.target.value; if (operator === 'equals' || operator === 'contains' || operator === 'has_tag' || operator === 'is_set') onChange({ ...step, operator }); }}><option value="equals">Equals</option><option value="contains">Contains</option><option value="has_tag">Has tag</option><option value="is_set">Has a value</option></Select></Field>{step.operator !== 'is_set' && <Field label="Value"><input aria-label="Condition value" value={step.value} onChange={event => onChange({ ...step, value: event.target.value })} /></Field>}</>}<Destination label={step.field === '$link_clicked' ? 'If visited' : 'If yes'} value={step.yes} nodes={destinations} onChange={yes => onChange({ ...step, yes })} /><Destination label={step.field === '$link_clicked' ? 'If not visited' : 'If no'} value={step.no} nodes={destinations} onChange={no => onChange({ ...step, no })} /></>;
    case 'action': return <><Field label="Tag to apply"><input aria-label="Tag to apply" value={step.tag} maxLength={80} onChange={event => onChange({ ...step, tag: event.target.value })} /></Field><Destination value={step.next} nodes={destinations} onChange={next => onChange({ ...step, next })} /></>;
    case 'delay': return <><Field label="Wait in seconds" hint="The messaging window is checked again when the wait ends. Maximum 7 days."><input aria-label="Delay seconds" type="number" min={1} max={604800} value={step.seconds} onChange={event => onChange({ ...step, seconds: Number(event.target.value) })} /></Field><Destination value={step.next} nodes={destinations} onChange={next => onChange({ ...step, next })} /></>;
    case 'end': return <Field label="Finish with"><Select aria-label="End outcome" value={step.outcome} onChange={event => onChange({ ...step, outcome: event.target.value === 'handoff' ? 'handoff' : 'complete' })}><option value="complete">Complete the conversation</option><option value="handoff">Hand off to a person</option></Select></Field>;
  }
}
