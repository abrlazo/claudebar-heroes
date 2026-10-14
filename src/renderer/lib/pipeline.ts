// Pure model of the workflow pipeline pane: the running work of the active project as a list of stages.
// No React. Every function returns new objects and never mutates its input (tools/check-pipeline.mjs tests it).
// The model only reads small, already-reactive inputs (never an agent's log), and all text is plain text.

export const MAX_NODES = 12;
export const DETAIL_MAX = 80;
export const QUEUED_MAX = 40;
/** The final states stay on screen this long after the work ends. */
export const LINGER_MS = 4000;

export type NodeKind = 'quest' | 'agent' | 'chain-step' | 'queued';
export type NodeState = 'waiting' | 'running' | 'asking' | 'done' | 'failed' | 'cancelled';

export interface PipelineNode {
  id: string;
  kind: NodeKind;
  label: string;
  state: NodeState;
  detail: string;
  startedAt: number | null;
  endedAt?: number;
  /** Tool calls so far (Quest and agents). */
  tools: number;
}

export interface PipelineModel {
  nodes: PipelineNode[];
  /** "2 running · 1 waiting for OK" while work goes, "2 done · 1 failed" after it. */
  headline: string;
  /** Something is running, waiting for OK or waiting its turn (queued messages alone do not count). */
  active: boolean;
  /** Extra lines under the list: "+N in other projects", "+N more". */
  notes: string[];
}

export interface PipelineTool { name: string; summary?: string }
export interface PipelineAgent {
  id: string;
  name: string;
  wsId: string;
  status: 'running' | 'done';
  outcome?: 'done' | 'error' | 'cancelled';
  observed?: boolean;
  startedAt: number;
  endedAt?: number;
  lastTool?: PipelineTool;
  toolCount?: number;
}

export interface PipelineInput {
  wsId: string | null;
  /** The Expedition run (`wsId` = the project it runs in). */
  quest: {
    wsId: string | null;
    running: boolean;
    starting: boolean;
    startedAt: number | null;
    endedAt?: number;
    outcome?: 'done' | 'failed' | 'cancelled';
    lastTool?: PipelineTool;
    toolCount?: number;
  };
  agents: PipelineAgent[];
  /** Steps still to start behind a running agent: agent id -> project and step names. */
  chainSteps: Record<string, { wsId: string; names: string[] }>;
  /** Owners with a pending permission request. */
  permissions: Array<{ owner: { kind: 'quest'; wsId: string } | { kind: 'agent'; agentId: string } }>;
  /** Texts waiting in the active project's message queue. */
  queued: string[];
  /** The current burst of work began here; older finished agents are not shown. */
  since: number;
}

// Control, bidi and zero-width characters never reach the pane.
// eslint-disable-next-line no-control-regex
const UNSAFE = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u2069\\ufeff]+', 'g');

/** Plain, single-line, clipped text. */
export function cleanText(text: string | undefined, max: number): string {
  const t = (text ?? '').replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const toolText = (t: PipelineTool | undefined): string => (t ? cleanText(t.summary ? `${t.name}: ${t.summary}` : t.name, DETAIL_MAX) : '');

const ACTIVE: NodeState[] = ['waiting', 'running', 'asking'];
export const isActiveState = (s: NodeState): boolean => ACTIVE.includes(s);

/** Builds the model for the active project. */
export function buildPipeline(input: PipelineInput): PipelineModel {
  const { wsId, quest, agents, chainSteps, permissions, queued, since } = input;
  const all: PipelineNode[] = [];
  let others = 0;

  const questAsks = permissions.some((p) => p.owner.kind === 'quest' && p.owner.wsId === wsId);
  const agentAsks = new Set(permissions.flatMap((p) => (p.owner.kind === 'agent' ? [p.owner.agentId] : [])));

  const questLive = quest.running || quest.starting;
  const questShown = questLive || (quest.outcome !== undefined && (quest.endedAt ?? 0) >= since);
  if (questShown && quest.wsId !== wsId) {
    if (questLive) others += 1;
  } else if (questShown) {
    let state: NodeState;
    if (questLive) state = questAsks ? 'asking' : 'running';
    else state = quest.outcome === 'failed' ? 'failed' : quest.outcome === 'cancelled' ? 'cancelled' : 'done';
    all.push({
      id: 'quest', kind: 'quest', label: 'Quest', state,
      detail: questLive && quest.starting && !quest.running ? 'starting' : toolText(quest.lastTool),
      startedAt: quest.startedAt, endedAt: quest.endedAt, tools: quest.toolCount ?? 0,
    });
  }

  const mine: PipelineAgent[] = [];
  for (const a of [...agents].sort((x, y) => x.startedAt - y.startedAt)) {
    const recent = a.status === 'running' || a.startedAt >= since || (a.endedAt ?? 0) >= since;
    if (!recent) continue;
    if (a.wsId !== wsId) { if (a.status === 'running') others += 1; continue; }
    mine.push(a);
    let state: NodeState;
    if (a.status === 'running') state = agentAsks.has(a.id) ? 'asking' : 'running';
    else state = a.outcome === 'error' ? 'failed' : a.outcome === 'cancelled' ? 'cancelled' : 'done';
    all.push({
      id: `agent:${a.id}`, kind: 'agent', label: cleanText(a.name, 40), state,
      detail: a.observed && !a.lastTool ? 'delegated by Claude' : toolText(a.lastTool),
      startedAt: a.startedAt, endedAt: a.status === 'done' ? a.endedAt : undefined, tools: a.toolCount ?? 0,
    });
  }

  for (const a of mine) {
    const chain = chainSteps[a.id];
    if (!chain || chain.wsId !== wsId) continue;
    chain.names.forEach((name, i) => {
      all.push({
        id: `chain:${a.id}:${i}`, kind: 'chain-step', label: `/${cleanText(name, 40)}`, state: 'waiting',
        detail: `after ${cleanText(i === 0 ? a.name : chain.names[i - 1], 40)}`, startedAt: null, tools: 0,
      });
    });
  }

  queued.forEach((text, i) => {
    all.push({ id: `queued:${i}`, kind: 'queued', label: `Queued ${i + 1}`, state: 'waiting', detail: cleanText(text, QUEUED_MAX), startedAt: null, tools: 0 });
  });

  const nodes = all.slice(0, MAX_NODES);
  const notes: string[] = [];
  if (all.length > MAX_NODES) notes.push(`+${all.length - MAX_NODES} more`);
  if (others > 0) notes.push(`+${others} in other projects`);

  const count = (s: NodeState) => nodes.filter((n) => n.state === s).length;
  const active = all.some((n) => n.kind !== 'queued' && isActiveState(n.state));
  const parts: string[] = [];
  if (active) {
    const waitingTurn = all.filter((n) => n.kind === 'chain-step' || n.kind === 'queued').length;
    if (count('running')) parts.push(`${count('running')} running`);
    if (count('asking')) parts.push(`${count('asking')} waiting for OK`);
    if (waitingTurn) parts.push(`${waitingTurn} queued`);
    if (count('failed')) parts.push(`${count('failed')} failed`);
  } else {
    if (count('done')) parts.push(`${count('done')} done`);
    if (count('failed')) parts.push(`${count('failed')} failed`);
    if (count('cancelled')) parts.push(`${count('cancelled')} stopped`);
  }
  return { nodes, headline: parts.join(' · '), active, notes };
}

export const isActive = (m: PipelineModel): boolean => m.active;

/** The pane is shown while there is work, and for LINGER_MS after the last of it. */
export function shouldShow(opts: { working: boolean; lastWorkAt: number | null; now: number; hasNodes: boolean }): boolean {
  if (!opts.hasNodes) return false;
  if (opts.working) return true;
  return opts.lastWorkAt !== null && opts.now - opts.lastWorkAt < LINGER_MS;
}

/** Structural equality of everything the pane shows (the hook keeps the old reference when true). */
export function sameModel(a: PipelineModel, b: PipelineModel): boolean {
  if (a === b) return true;
  if (a.headline !== b.headline || a.active !== b.active || a.nodes.length !== b.nodes.length || a.notes.length !== b.notes.length) return false;
  if (a.notes.some((n, i) => n !== b.notes[i])) return false;
  return a.nodes.every((n, i) => {
    const o = b.nodes[i];
    return n.id === o.id && n.kind === o.kind && n.label === o.label && n.state === o.state && n.detail === o.detail
      && n.startedAt === o.startedAt && n.endedAt === o.endedAt && n.tools === o.tools;
  });
}

/** "12s", "1m 05s" */
export function elapsedLabel(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}
