import { useCallback, useEffect, useRef, useState } from 'react';
import { bar } from '../lib/bridge';
import { useBridgeEvent } from './useBridgeEvent';
import { generateHero } from '../engine/heroes.js';
import { MAX_AGENTS, REVIEW_AGENT, handoffTask, idleLimitMs, uniqueAgentName } from '../lib/agents';
import { dueAgents, nextDeadline } from '../lib/idle';
import type { AgentInvocation } from '../lib/agents';
import type { GameApi } from './useGameEngine';
import type { PermissionsApi } from './usePermissions';
import type { AgentDefinition, AgentEvent, ArchivedAgent, ChatMessage, ClaudeEvent, Hero, PermissionMode, Usage, Workspace } from '../types';

const DEATH_ANIMATION_MS = 600;

/** The steps queued behind a new agent and how many steps the chain has in all. */
export interface ChainSpec {
  rest: AgentInvocation[];
  total: number;
}

/** Steps still waiting behind a running agent ("/a x && /b"). Not persisted. */
interface Chain extends ChainSpec {
  ws: Workspace;
  permissionMode: PermissionMode;
}

/** Claude's delegation to one of the project's agents, as the Expedition run reports it. */
interface Delegation {
  wsId: string;
  /** checking = the project's agent definitions are still being read; ignored = not a known agent. */
  state: 'checking' | 'live' | 'ignored';
  agentId?: string;
  /** Events that arrived while checking. */
  queue: ClaudeEvent[];
  /** The run ended while checking. */
  closed: boolean;
}

/** Appends streamed text to the agent's last assistant message, or starts one. */
function withText(a: Agent, text: string): Agent {
  const tail = a.log[a.log.length - 1];
  if (tail?.kind === 'assistant') return { ...a, log: [...a.log.slice(0, -1), { ...tail, text: tail.text + text }] };
  return { ...a, log: [...a.log, { kind: 'assistant', text }] };
}

export interface Agent {
  id: string;
  name: string;
  status: 'running' | 'done';
  /** The .claude/agents definition this agent runs as. */
  definition: string;
  hero: Hero;
  /** Order of creation; picks the orb's colour. */
  index: number;
  dying: boolean;
  /** Claude session of this agent, needed to send it follow-up messages. */
  sessionId?: string;
  log: ChatMessage[];
  /**
   * Claude delegated to this agent during the Expedition run. It has no process of its own: it cannot be
   * messaged or stopped separately and does not use one of the MAX_AGENTS start slots. Kept in memory only.
   */
  observed?: boolean;
  /** The project the agent belongs to (agents of every project share one list). */
  wsId: string;
  startedAt: number;
  /** When it last finished (cleared while it works again). */
  endedAt?: number;
  /** How it ended; set when it goes done. */
  outcome?: 'done' | 'error' | 'cancelled';
  /** Last event, message to it, or the user opening its tab: the idle timer counts from here. */
  lastActivityAt: number;
  usage: Usage;
}

const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });

/** The Agent as an archive record (main clamps it again; archivedAt is set there). */
function toRecord(a: Agent, status: ArchivedAgent['status'], reason: ArchivedAgent['reason']): Omit<ArchivedAgent, 'archivedAt'> {
  const first = a.log.find((m) => m.kind === 'user');
  return {
    id: a.id, name: a.name, definition: a.definition,
    task: first && first.kind === 'user' ? first.text : '',
    observed: !!a.observed, status, reason,
    startedAt: a.startedAt, endedAt: a.endedAt ?? null,
    usage: a.usage, sessionId: a.sessionId ?? null, messages: a.log,
  };
}

export interface AgentsApi {
  agents: Agent[];
  selectedId: string | null;
  select: (id: string | null) => void;
  /** Closes an agent's tab: a running agent is stopped first, then its chat goes to the archive. */
  remove: (id: string) => void;
  /**
   * Starts `definition` on `task` in its own tab and orb. Rejects with an Error if it could not start.
   * `chain` = the steps to start, one after another, as each agent finishes successfully.
   */
  spawn: (ws: Workspace, definition: AgentDefinition, task: string, permissionMode: PermissionMode, chain?: ChainSpec) => Promise<void>;
  /** Sends a follow-up message to a finished agent by resuming its session. */
  message: (ws: Workspace, agentId: string, prompt: string, permissionMode: PermissionMode) => void;
  /** Cancels one running agent. */
  stop: (wsId: string, agentId: string) => void;
  stopAll: (wsId: string) => void;
  running: boolean;
  /**
   * Feeds one 'subagent' event of the Expedition run. Returns true when it belongs to an agent shown here
   * (or one still being checked), false for built-in or unknown agents, which stay ordinary tool lines.
   */
  observe: (ev: ClaudeEvent) => boolean;
  /** The Expedition run in `wsId` ended: finish the agents Claude delegated to (cancelled when it was stopped). */
  endObserved: (wsId: string, cancelled: boolean) => void;
  /** Adds a meta line (not a user message) to an agent's log, e.g. what the user allowed or denied. */
  logMeta: (agentId: string, text: string) => void;
}

/**
 * Agents started with "/<agent-name> <task>". Each runs in its own process with
 * its own log (an agent tab) and a spirit orb beside the hero. The source of
 * truth is `agentsRef` so event handlers never read stale state; `agents`
 * mirrors it for rendering.
 */
export function useAgents({ game, say, notify, archive, onUnclaimed, permissions }: {
  game: GameApi;
  say: (text: string, ms?: number) => void;
  /** Posts a meta message in a workspace's Expedition chat (chain progress). */
  notify: (wsId: string, text: string) => void;
  /** Keeps a chat in the project's archive (false when it could not be saved). */
  archive: (wsId: string, record: Omit<ArchivedAgent, 'archivedAt'>) => Promise<boolean>;
  /** An inner event of a delegation that turned out not to be a known agent: show it as an ordinary event. */
  onUnclaimed: (ev: ClaudeEvent) => void;
  /** The permission cards: this hook feeds it the agents' requests. */
  permissions: Pick<PermissionsApi, 'add' | 'resolve' | 'clearOwner'>;
}): AgentsApi {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(0); // agents whose start request is still in flight
  const agentsRef = useRef<Agent[]>([]);
  const selectedRef = useRef<string | null>(null);
  const spawningRef = useRef(0);
  const pending = useRef(new Map<string, AgentEvent[]>()); // events that beat runAgent() resolving
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const created = useRef(0);
  const chains = useRef(new Map<string, Chain>()); // running agent id -> what runs after it
  const failed = useRef(new Set<string>()); // agents that errored or were cancelled
  const stopped = useRef(new Set<string>()); // agents the user stopped (their end is "cancelled", not an error)
  const handingOff = useRef(new Set<string>()); // finished agents whose log a chain hand-off is still reading
  const retiring = useRef(new Set<string>()); // retire() in flight
  const archiveFailed = useRef(new Set<string>()); // agents whose failed archiving was already reported
  const [idleTick, setIdleTick] = useState(0); // bumped to re-plan the idle timer when the plan changed without a render
  const archiveRef = useRef(archive);
  archiveRef.current = archive;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const unclaimedRef = useRef(onUnclaimed);
  unclaimedRef.current = onUnclaimed;
  const delegations = useRef(new Map<string, Delegation>()); // Claude's Agent tool_use id -> observed agent
  const spawnRef = useRef<AgentsApi['spawn'] | null>(null);

  const commit = useCallback((next: Agent[]) => {
    agentsRef.current = next;
    setAgents(next);
  }, []);

  const update = useCallback((id: string, fn: (a: Agent) => Agent) => {
    commit(agentsRef.current.map((a) => (a.id === id ? fn(a) : a)));
  }, [commit]);

  const select = useCallback((id: string | null) => {
    const prev = selectedRef.current;
    selectedRef.current = id;
    setSelectedId(id);
    // Opening a tab, and leaving it, both restart its idle time.
    if (prev !== id && (prev || id)) {
      const now = Date.now();
      commit(agentsRef.current.map((a) => (a.id === prev || a.id === id ? { ...a, lastActivityAt: now } : a)));
    }
  }, [commit]);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => { timers.current.delete(id); fn(); }, ms);
    timers.current.add(id);
    return id;
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  /** Forgets the steps queued behind `id` and tells the chat why. */
  const dropChain = useCallback((id: string, name: string, why: string) => {
    const chain = chains.current.get(id);
    if (!chain) return;
    chains.current.delete(id);
    const names = chain.rest.map((s) => s.definition.name).join(', ');
    notifyRef.current(chain.ws.id, `Chain stopped: ${name} ${why}. Dropped: ${names}.`);
  }, []);

  /** Starts the next queued step after `agent` finished OK, in the workspace the chain began in. */
  const advance = useCallback(async (agent: Agent) => {
    const wasFailed = failed.current.delete(agent.id);
    const chain = chains.current.get(agent.id);
    if (!chain) return;
    chains.current.delete(agent.id);
    const dropped = (why: string) => notifyRef.current(
      chain.ws.id, `Chain stopped: ${why}. Dropped: ${chain.rest.map((s) => s.definition.name).join(', ')}.`,
    );
    if (wasFailed) { dropped(`${agent.name} failed or was cancelled`); return; }
    const [step, ...rest] = chain.rest;
    spawningRef.current += 1; // keeps the hero awake and events queued during the hand-off
    setSpawning((n) => n + 1);
    try {
      const lastReply = [...agent.log].reverse().find((m) => m.kind === 'assistant');
      const prevText = lastReply && lastReply.kind === 'assistant' ? lastReply.text : '';
      let hasReview = false;
      if (!step.task && agent.definition === REVIEW_AGENT) {
        try { hasReview = await bar.projectHasReview(chain.ws.id); } catch { /* treated as no file */ }
      }
      const next = handoffTask({ prevDefinition: agent.definition, prevName: agent.name, prevText, task: step.task, hasReview });
      if ('stop' in next) { dropped(next.stop); return; }
      // Slots full: stop with a message (waiting could hang a chain behind unrelated work).
      if (agentsRef.current.filter((a) => a.status === 'running' && !a.observed).length >= MAX_AGENTS) {
        dropped(`${MAX_AGENTS} agents are already working, so ${step.definition.name} could not start`);
        return;
      }
      try {
        await spawnRef.current?.(chain.ws, step.definition, next.task, chain.permissionMode, { rest, total: chain.total });
        notifyRef.current(chain.ws.id, `Chain: ${step.definition.name} started (step ${chain.total - rest.length} of ${chain.total}).`);
      } catch (err) {
        dropped(`${step.definition.name} could not start (${(err as Error).message})`);
      }
    } finally {
      spawningRef.current -= 1;
      setSpawning((n) => n - 1);
    }
  }, []);

  const complete = useCallback((id: string) => {
    const agent = agentsRef.current.find((a) => a.id === id);
    if (!agent || agent.status === 'done') return;
    const outcome = stopped.current.has(id) ? 'cancelled' : failed.current.has(id) ? 'error' : 'done';
    const now = Date.now();
    update(id, (a) => ({ ...a, status: 'done', outcome, endedAt: now, lastActivityAt: now }));
    handingOff.current.add(id); // the idle timer leaves it alone until advance() has read its log
    void advance(agent).finally(() => {
      handingOff.current.delete(id);
      setIdleTick((n) => n + 1); // the finished agent may retire now (re-plans the idle timer)
    });
    if (agentsRef.current.every((a) => a.status === 'done') && spawningRef.current === 0) say('All agents complete!', 2500);
  }, [advance, say, update]);

  const handleEvent = useCallback((ev: AgentEvent) => {
    const { agentId, type } = ev;
    const agent = agentsRef.current.find((a) => a.id === agentId);
    if (!agent) {
      // A closed tab's process still reports its end: its cards can never be answered.
      if (type === 'end') permissions.clearOwner({ kind: 'agent', agentId });
      if (spawningRef.current > 0) {
        const queue = pending.current.get(agentId) ?? [];
        queue.push(ev);
        pending.current.set(agentId, queue);
      }
      return;
    }

    // Any event counts as activity for the idle timer.
    const touch = (a: Agent): Agent => ({ ...a, lastActivityAt: Date.now() });
    switch (type) {
      case 'session':
        update(agentId, (a) => touch(ev.sessionId ? { ...a, sessionId: ev.sessionId } : a));
        break;
      case 'usage':
        update(agentId, (a) => {
          const u = ev.usage;
          const usage = u ? {
            input: a.usage.input + (u.input || 0), output: a.usage.output + (u.output || 0),
            cacheRead: a.usage.cacheRead + (u.cacheRead || 0), cacheCreate: a.usage.cacheCreate + (u.cacheCreate || 0),
          } : a.usage;
          return touch({ ...a, usage });
        });
        break;
      case 'text':
        update(agentId, (a) => touch(withText(a, ev.text ?? '')));
        break;
      case 'tool':
        update(agentId, (a) => touch({ ...a, log: [...a.log, { kind: 'tool', name: ev.name ?? 'tool', summary: ev.summary }] }));
        game.toolEnemy(ev.name ?? '');
        break;
      case 'permission':
        // A running agent waiting for the user is still running: touched (never idle-retired) and shown on its tab.
        update(agentId, touch);
        permissions.add({ kind: 'agent', agentId }, ev);
        say('Needs your OK!', 3000);
        break;
      case 'permission-resolved':
        update(agentId, touch);
        if (ev.requestId) permissions.resolve(ev.requestId, ev.how ?? 'ended');
        break;
      case 'error':
        failed.current.add(agentId);
        // claude.js puts error text in `message`, not `text`.
        update(agentId, (a) => touch({ ...a, log: [...a.log, { kind: 'error', text: ev.message || ev.text || 'Agent error' }] }));
        break;
      case 'result':
        if (ev.isError) failed.current.add(agentId);
        // Cost and turns live on the 'result' event, not on 'end'.
        update(agentId, touch);
        if (ev.costUsd != null) {
          const text = `${ev.turns} turn(s) · $${ev.costUsd.toFixed(4)}`;
          update(agentId, (a) => touch({ ...a, log: [...a.log, { kind: 'meta', text }] }));
        }
        break;
      case 'end':
        permissions.clearOwner({ kind: 'agent', agentId }); // the process is gone
        if (ev.code !== 0) failed.current.add(agentId);
        complete(agentId);
        break;
      default:
        break;
    }
  }, [complete, game, permissions, say, update]);

  useBridgeEvent<AgentEvent>(bar.onAgentEvent, handleEvent);

  const spawn = useCallback(async (ws: Workspace, definition: AgentDefinition, task: string, permissionMode: PermissionMode, chain?: ChainSpec) => {
    spawningRef.current += 1;
    setSpawning((n) => n + 1);
    try {
      const displayName = uniqueAgentName(definition.name, agentsRef.current.map((a) => a.name));
      const result = await bar.runAgent(ws.id, definition.name, displayName, task, permissionMode);
      if (!result.agent) throw new Error(result.error || 'the agent could not start');
      const record = result.agent;
      if (chain?.rest.length) chains.current.set(record.id, { ws, rest: chain.rest, total: chain.total, permissionMode });
      const index = created.current;
      created.current += 1;
      const now = Date.now();
      commit([
        ...agentsRef.current,
        {
          id: record.id,
          name: record.name,
          wsId: ws.id, startedAt: now, lastActivityAt: now, usage: emptyUsage(),
          status: 'running',
          definition: result.definitionName ?? definition.name,
          hero: generateHero(Math.random().toString(36).substring(7)) as Hero,
          index,
          dying: false,
          log: [{ kind: 'user', text: task }],
        },
      ]);
      game.wake();
      // Replay events that arrived before the run request resolved.
      const early = pending.current.get(record.id) || [];
      pending.current.delete(record.id);
      early.forEach(handleEvent);
    } finally {
      spawningRef.current -= 1;
      setSpawning((n) => n - 1);
    }
  }, [commit, game, handleEvent]);

  spawnRef.current = spawn;

  const message = useCallback((ws: Workspace, agentId: string, prompt: string, permissionMode: PermissionMode) => {
    const agent = agentsRef.current.find((a) => a.id === agentId);
    if (!agent || agent.status === 'running' || agent.observed) return; // observed agents have no process to resume
    if (!agent.sessionId) {
      update(agentId, (a) => ({ ...a, log: [...a.log, { kind: 'error', text: 'This agent has no session to continue.' }] }));
      return;
    }
    stopped.current.delete(agentId);
    update(agentId, (a) => ({ ...a, status: 'running', outcome: undefined, endedAt: undefined, lastActivityAt: Date.now(), log: [...a.log, { kind: 'user', text: prompt }] }));
    game.wake();
    bar.messageAgent(ws.id, agentId, agent.sessionId, agent.definition, prompt, ws.path, permissionMode);
  }, [game, update]);

  const logMeta = useCallback((agentId: string, text: string) => {
    update(agentId, (a) => ({ ...a, lastActivityAt: Date.now(), log: [...a.log, { kind: 'meta', text }] }));
  }, [update]);

  const stop = useCallback((wsId: string, agentId: string) => {
    const agent = agentsRef.current.find((a) => a.id === agentId);
    if (!agent || agent.observed) return; // an observed agent stops with the Expedition run
    dropChain(agentId, agent.name, 'was stopped');
    stopped.current.add(agentId);
    bar.cancelAgent(wsId, agentId);
  }, [dropChain]);

  /** Cancels every agent that is still running. */
  const stopAll = useCallback((wsId: string) => {
    for (const a of agentsRef.current) {
      if (a.status === 'done' || a.observed) continue; // observed agents stop with the Expedition run
      dropChain(a.id, a.name, 'was stopped');
      stopped.current.add(a.id);
      bar.cancelAgent(wsId, a.id);
    }
  }, [dropChain]);

  /** Marks an observed agent finished and logs its result (or the error). */
  const finishObserved = useCallback((agentId: string, isError: boolean, text?: string, cancelled = false) => {
    const agent = agentsRef.current.find((a) => a.id === agentId);
    if (!agent || agent.status === 'done') return;
    const result = (text ?? '').trim();
    update(agentId, (a) => {
      const tail = a.log[a.log.length - 1];
      let log = a.log;
      if (isError) log = [...log, { kind: 'error', text: result || 'The agent failed' }];
      else if (result && !(tail?.kind === 'assistant' && tail.text.trim() === result)) log = [...log, { kind: 'assistant', text: result }];
      const now = Date.now();
      return { ...a, status: 'done', log, outcome: cancelled ? 'cancelled' : isError ? 'error' : 'done', endedAt: now, lastActivityAt: now };
    });
  }, [update]);

  const applyObserved = useCallback((d: Delegation, ev: ClaudeEvent) => {
    const agentId = d.agentId;
    if (!agentId) return;
    if (ev.phase === 'end') {
      finishObserved(agentId, !!ev.isError, ev.text);
    } else if (ev.phase === 'event' && ev.inner === 'tool') {
      update(agentId, (a) => ({ ...a, lastActivityAt: Date.now(), log: [...a.log, { kind: 'tool', name: ev.name ?? 'tool', summary: ev.summary }] }));
      game.toolEnemy(ev.name ?? '');
    } else if (ev.phase === 'event' && ev.inner === 'text' && ev.text) {
      update(agentId, (a) => ({ ...withText(a, ev.text ?? ''), lastActivityAt: Date.now() }));
    }
  }, [finishObserved, game, update]);

  /** Shows a delegation as an agent only if its type is one of the project's own definitions (same gate as "/<agent>"). */
  const beginObserved = useCallback(async (d: Delegation, ev: ClaudeEvent) => {
    let definitions: AgentDefinition[] = [];
    try {
      definitions = await bar.agentDefinitions(d.wsId);
    } catch { /* unknown: not shown as an agent */ }
    const wanted = (ev.agentType ?? '').toLowerCase();
    const definition = definitions.find((def) => def.name.toLowerCase() === wanted);
    const queued = d.queue;
    d.queue = [];
    if (!definition || d.closed) {
      d.state = 'ignored';
      if (!d.closed) queued.forEach((q) => unclaimedRef.current(q));
      return;
    }
    const name = uniqueAgentName(definition.name, agentsRef.current.map((a) => a.name));
    const id = `observed-${ev.toolUseId}`;
    const prompt = ev.prompt || ev.description || '';
    const index = created.current;
    created.current += 1;
    const now = Date.now();
    commit([
      ...agentsRef.current,
      {
        id, name, status: 'running', definition: definition.name,
        wsId: d.wsId, startedAt: now, lastActivityAt: now, usage: emptyUsage(),
        hero: generateHero(Math.random().toString(36).substring(7)) as Hero,
        index, dying: false, observed: true,
        log: prompt ? [{ kind: 'user', text: prompt }] : [],
      },
    ]);
    d.state = 'live';
    d.agentId = id;
    game.wake();
    notifyRef.current(d.wsId, `${name} was delegated by Claude, see its tab.`);
    queued.forEach((q) => applyObserved(d, q));
  }, [applyObserved, commit, game]);

  const observe = useCallback((ev: ClaudeEvent): boolean => {
    const id = ev.toolUseId;
    if (!id) return false;
    if (ev.phase === 'start') {
      if (delegations.current.has(id) || !ev.wsId) return false;
      const d: Delegation = { wsId: ev.wsId, state: 'checking', queue: [], closed: false };
      delegations.current.set(id, d);
      void beginObserved(d, ev);
      return true;
    }
    const d = delegations.current.get(id);
    if (!d || d.state === 'ignored') return false;
    if (d.state === 'checking') d.queue.push(ev);
    else applyObserved(d, ev);
    return true;
  }, [applyObserved, beginObserved]);

  const endObserved = useCallback((wsId: string, cancelled: boolean) => {
    for (const [id, d] of [...delegations.current]) {
      if (d.wsId !== wsId) continue;
      if (d.state === 'checking') d.closed = true;
      else if (d.agentId) finishObserved(d.agentId, cancelled, cancelled ? 'Cancelled: the Expedition run was stopped.' : undefined, cancelled);
      delegations.current.delete(id);
    }
  }, [finishObserved]);

  /**
   * Moves an agent's chat to the project's archive, then plays its death animation and drops it.
   * 'idle': the timer found a finished agent unused for the idle time. 'closed': the user pressed its X
   * (a running agent is stopped first and archived as cancelled).
   */
  const retire = useCallback(async (id: string, reason: ArchivedAgent['reason']) => {
    const first = agentsRef.current.find((a) => a.id === id);
    if (!first || first.dying || retiring.current.has(id)) return;
    if (reason === 'idle' && (first.status === 'running' || handingOff.current.has(id) || chains.current.has(id) || selectedRef.current === id)) return;
    retiring.current.add(id);
    try {
      let outcome: ArchivedAgent['status'] = first.outcome ?? 'done';
      if (reason === 'closed') {
        dropChain(id, first.name, first.status === 'running' ? 'was stopped' : 'was closed');
        if (first.status === 'running') {
          outcome = 'cancelled';
          stopped.current.add(id);
          // A running process must be stopped before main accepts it into the archive.
          if (!first.observed) { try { await bar.cancelAgent(first.wsId, id); } catch { /* the archive call below reports the problem */ } }
        }
      }
      const cur = agentsRef.current.find((a) => a.id === id);
      if (!cur) return;
      const ok = await archiveRef.current(cur.wsId, toRecord(cur, outcome, reason)).catch(() => false);
      const now = agentsRef.current.find((a) => a.id === id);
      if (!now || now.dying) return;
      if (reason === 'idle') {
        // Used meanwhile (a message, or its tab opened): it stays, a later retire replaces the same archive entry.
        if (now.status !== 'done' || now.lastActivityAt !== cur.lastActivityAt || selectedRef.current === id) return;
        if (!ok) {
          update(id, (a) => ({ ...a, lastActivityAt: Date.now() })); // try again after another idle period
          if (!archiveFailed.current.has(id)) {
            archiveFailed.current.add(id);
            notifyRef.current(cur.wsId, `Could not archive ${cur.name}; it stays open.`);
          }
          return;
        }
      } else if (!ok) {
        notifyRef.current(cur.wsId, `Could not save ${cur.name}'s chat to the archive.`);
      }
      update(id, (a) => ({ ...a, dying: true }));
      later(() => {
        commit(agentsRef.current.filter((a) => a.id !== id));
        if (selectedRef.current === id) select(null);
        failed.current.delete(id);
        stopped.current.delete(id);
        archiveFailed.current.delete(id);
      }, DEATH_ANIMATION_MS);
      if (reason === 'idle') say(`Archived ${cur.name}`, 1800);
    } finally {
      retiring.current.delete(id);
    }
  }, [commit, dropChain, later, say, select, update]);

  const remove = useCallback((id: string) => { void retire(id, 'closed'); }, [retire]);

  // One timer for all agents, in every project: it fires when the earliest finished agent is due.
  // Nothing polls; `idleKey` changes exactly when the plan could (activity of finished agents, status,
  // selection). Overdue agents (a sleeping laptop) retire at once.
  const limit = idleLimitMs();
  const idleKey = `${agents.map((a) => `${a.id}:${a.status}:${a.dying ? 1 : 0}:${a.status === 'done' ? a.lastActivityAt : ''}`).join('|')}#${selectedId}#${limit}#${idleTick}`;
  useEffect(() => {
    const due = nextDeadline(agentsRef.current, limit, selectedRef.current, handingOff.current);
    if (due === null) return undefined;
    const timer = setTimeout(() => {
      for (const a of dueAgents(agentsRef.current, Date.now(), limit, selectedRef.current, handingOff.current)) void retire(a.id, 'idle');
    }, Math.min(Math.max(0, due - Date.now()) + 25, 2 ** 31 - 1));
    return () => clearTimeout(timer);
  }, [idleKey, limit, retire]);

  const running = spawning > 0 || agents.some((a) => a.status !== 'done');
  return { agents, selectedId, select, remove, spawn, message, stop, stopAll, running, observe, endObserved, logMeta };
}
