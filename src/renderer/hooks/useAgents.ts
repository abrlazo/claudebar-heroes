import { useCallback, useEffect, useRef, useState } from 'react';
import { bar } from '../lib/bridge';
import { useBridgeEvent } from './useBridgeEvent';
import { generateHero } from '../engine/heroes.js';
import { uniqueAgentName } from '../lib/agents';
import type { GameApi } from './useGameEngine';
import type { AgentDefinition, AgentEvent, ChatMessage, Hero, PermissionMode, Workspace } from '../types';

const DEATH_ANIMATION_MS = 600;

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
}

export interface AgentsApi {
  agents: Agent[];
  selectedId: string | null;
  select: (id: string | null) => void;
  remove: (id: string) => void;
  /** Starts `definition` on `task` in its own tab and orb. Rejects with an Error if it could not start. */
  spawn: (ws: Workspace, definition: AgentDefinition, task: string, permissionMode: PermissionMode) => Promise<void>;
  /** Sends a follow-up message to a finished agent by resuming its session. */
  message: (ws: Workspace, agentId: string, prompt: string, permissionMode: PermissionMode) => void;
  /** Cancels one running agent. */
  stop: (wsId: string, agentId: string) => void;
  stopAll: (wsId: string) => void;
  running: boolean;
}

/**
 * Agents started with "/<agent-name> <task>". Each runs in its own process with
 * its own log (an agent tab) and a spirit orb beside the hero. The source of
 * truth is `agentsRef` so event handlers never read stale state; `agents`
 * mirrors it for rendering.
 */
export function useAgents({ game, say }: { game: GameApi; say: (text: string, ms?: number) => void }): AgentsApi {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(0); // agents whose start request is still in flight
  const agentsRef = useRef<Agent[]>([]);
  const selectedRef = useRef<string | null>(null);
  const spawningRef = useRef(0);
  const pending = useRef(new Map<string, AgentEvent[]>()); // events that beat runAgent() resolving
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const created = useRef(0);

  const commit = useCallback((next: Agent[]) => {
    agentsRef.current = next;
    setAgents(next);
  }, []);

  const update = useCallback((id: string, fn: (a: Agent) => Agent) => {
    commit(agentsRef.current.map((a) => (a.id === id ? fn(a) : a)));
  }, [commit]);

  const select = useCallback((id: string | null) => {
    selectedRef.current = id;
    setSelectedId(id);
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => { timers.current.delete(id); fn(); }, ms);
    timers.current.add(id);
    return id;
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const remove = useCallback((id: string) => {
    const agent = agentsRef.current.find((a) => a.id === id);
    if (!agent || agent.dying) return;
    update(id, (a) => ({ ...a, dying: true }));
    later(() => {
      commit(agentsRef.current.filter((a) => a.id !== id));
      if (selectedRef.current === id) select(null);
    }, DEATH_ANIMATION_MS);
  }, [commit, later, select, update]);

  const complete = useCallback((id: string) => {
    const agent = agentsRef.current.find((a) => a.id === id);
    if (!agent || agent.status === 'done') return;
    update(id, (a) => ({ ...a, status: 'done' }));
    if (agentsRef.current.every((a) => a.status === 'done')) say('All agents complete!', 2500);
  }, [say, update]);

  const handleEvent = useCallback((ev: AgentEvent) => {
    const { agentId, type } = ev;
    const agent = agentsRef.current.find((a) => a.id === agentId);
    if (!agent) {
      if (spawningRef.current > 0) {
        const queue = pending.current.get(agentId) ?? [];
        queue.push(ev);
        pending.current.set(agentId, queue);
      }
      return;
    }

    switch (type) {
      case 'session':
        if (ev.sessionId) update(agentId, (a) => ({ ...a, sessionId: ev.sessionId }));
        break;
      case 'text':
        update(agentId, (a) => {
          const tail = a.log[a.log.length - 1];
          if (tail?.kind === 'assistant') {
            return { ...a, log: [...a.log.slice(0, -1), { ...tail, text: tail.text + (ev.text ?? '') }] };
          }
          return { ...a, log: [...a.log, { kind: 'assistant', text: ev.text ?? '' }] };
        });
        break;
      case 'tool':
        update(agentId, (a) => ({ ...a, log: [...a.log, { kind: 'tool', name: ev.name ?? 'tool', summary: ev.summary }] }));
        game.toolEnemy(ev.name ?? '');
        break;
      case 'error':
        // claude.js puts error text in `message`, not `text`.
        update(agentId, (a) => ({ ...a, log: [...a.log, { kind: 'error', text: ev.message || ev.text || 'Agent error' }] }));
        break;
      case 'result':
        // Cost and turns live on the 'result' event, not on 'end'.
        if (ev.costUsd != null) {
          const text = `${ev.turns} turn(s) · $${ev.costUsd.toFixed(4)}`;
          update(agentId, (a) => ({ ...a, log: [...a.log, { kind: 'meta', text }] }));
        }
        break;
      case 'end':
        complete(agentId);
        break;
      default:
        break;
    }
  }, [complete, game, update]);

  useBridgeEvent<AgentEvent>(bar.onAgentEvent, handleEvent);

  const spawn = useCallback(async (ws: Workspace, definition: AgentDefinition, task: string, permissionMode: PermissionMode) => {
    spawningRef.current += 1;
    setSpawning((n) => n + 1);
    try {
      const displayName = uniqueAgentName(definition.name, agentsRef.current.map((a) => a.name));
      const result = await bar.runAgent(ws.id, definition.name, displayName, task, permissionMode);
      if (!result.agent) throw new Error(result.error || 'the agent could not start');
      const record = result.agent;
      const index = created.current;
      created.current += 1;
      commit([
        ...agentsRef.current,
        {
          id: record.id,
          name: record.name,
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

  const message = useCallback((ws: Workspace, agentId: string, prompt: string, permissionMode: PermissionMode) => {
    const agent = agentsRef.current.find((a) => a.id === agentId);
    if (!agent || agent.status === 'running') return;
    if (!agent.sessionId) {
      update(agentId, (a) => ({ ...a, log: [...a.log, { kind: 'error', text: 'This agent has no session to continue.' }] }));
      return;
    }
    update(agentId, (a) => ({ ...a, status: 'running', log: [...a.log, { kind: 'user', text: prompt }] }));
    game.wake();
    bar.messageAgent(ws.id, agentId, agent.sessionId, agent.definition, prompt, ws.path, permissionMode);
  }, [game, update]);

  const stop = useCallback((wsId: string, agentId: string) => { bar.cancelAgent(wsId, agentId); }, []);

  /** Cancels every agent that is still running. */
  const stopAll = useCallback((wsId: string) => {
    for (const a of agentsRef.current) if (a.status !== 'done') bar.cancelAgent(wsId, a.id);
  }, []);

  const running = spawning > 0 || agents.some((a) => a.status !== 'done');
  return { agents, selectedId, select, remove, spawn, message, stop, stopAll, running };
}
