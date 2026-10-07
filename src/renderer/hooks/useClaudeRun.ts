import { useCallback, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { bar } from '../lib/bridge';
import { useSettings } from '../context/SettingsContext';
import { useBridgeEvent } from './useBridgeEvent';
import type { GameApi } from './useGameEngine';
import { levelFor, totalTokens, xpFor } from '../lib/leveling';
import { popXp } from '../lib/effects';
import { formatTokens } from '../lib/format';
import type { ClaudeEvent, ModelAlias, Usage } from '../types';

export interface Streaming {
  wsId: string | null;
  text: string;
  /** Claude's thinking text for the current step, while it streams. */
  thinking: string;
}

const EMPTY_STREAM: Streaming = { wsId: null, text: '', thinking: '' };
const EMPTY_USAGE: Usage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };

const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheCreate: a.cacheCreate + b.cacheCreate,
});

/** "in 12k · out 340 · cached 10k" */
export function usageLine(u: Usage): string {
  return `in ${formatTokens(u.input + u.cacheCreate)} · out ${formatTokens(u.output)} · cached ${formatTokens(u.cacheRead)}`;
}

export interface ClaudeRun {
  running: boolean;
  /** Workspace the current run belongs to (null when idle). */
  runWsId: string | null;
  streaming: Streaming;
  /** Tokens used so far in the current run (null when idle). */
  liveUsage: Usage | null;
  send: (wsId: string, prompt: string, model: ModelAlias) => void;
  stop: () => void;
  /** Handles an inner event of a delegation that is not a shown agent as an ordinary tool line or text. */
  replay: (ev: ClaudeEvent) => void;
}

interface Deps {
  game: GameApi;
  say: (text: string, ms?: number) => void;
  setStatus: (text: string) => void;
  stageRef: RefObject<HTMLDivElement | null>;
  /** true while Claude OR agents work */
  busyRef: RefObject<boolean>;
  /** Claude's delegations to the project's agents (see `useAgents`). `observe` returns false for other agents. */
  observe: (ev: ClaudeEvent) => boolean;
  endObserved: (wsId: string, cancelled: boolean) => void;
}

/**
 * Runs the project chat: sends prompts to Claude Code and turns its event
 * stream into saved chat messages, hero XP and battle-strip reactions.
 *
 * Thinking and assistant text stream into `streaming`; each is saved as a
 * normal message (`flush`) as soon as something else is logged, so saved
 * order matches what was shown. `liveUsage` counts tokens as the run goes:
 * finished model calls plus the input already known for the call in flight.
 */
export function useClaudeRun({ game, say, setStatus, stageRef, busyRef, observe, endObserved }: Deps): ClaudeRun {
  const { getSettings, persistMessage, patchWorkspaceLocal } = useSettings();
  const [running, setRunning] = useState(false);
  const [activeRunWsId, setActiveRunWsId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<Streaming>(EMPTY_STREAM);
  const [liveUsage, setLiveUsage] = useState<Usage | null>(null);
  const runWsId = useRef<string | null>(null);
  const text = useRef('');
  const thinking = useRef('');
  const doneUsage = useRef<Usage>(EMPTY_USAGE);

  const flushThinking = useCallback(() => {
    if (thinking.current && runWsId.current) {
      persistMessage(runWsId.current, { kind: 'thinking', text: thinking.current });
    }
    thinking.current = '';
  }, [persistMessage]);

  const flush = useCallback(() => {
    flushThinking();
    if (text.current && runWsId.current) {
      persistMessage(runWsId.current, { kind: 'assistant', text: text.current });
    }
    text.current = '';
    setStreaming(EMPTY_STREAM);
  }, [flushThinking, persistMessage]);

  const applyUsage = useCallback((ev: ClaudeEvent) => {
    const current = getSettings();
    const ws = current.workspaces.find((w) => w.id === ev.wsId);
    if (!ws || !ev.totals) return;
    const before = xpFor(ws);
    const after = xpFor({ usage: ev.totals });
    patchWorkspaceLocal(ws.id, { usage: ev.totals, lastContext: ev.lastContext });
    if (ws.id !== current.activeId) return;
    if (after > before) popXp(stageRef.current, after - before);
    if (levelFor(after) > levelFor(before)) say(`Level up! Lv ${levelFor(after)}`, 3500);
  }, [getSettings, patchWorkspaceLocal, say, stageRef]);

  const handle = (ev: ClaudeEvent) => {
    switch (ev.type) {
      case 'start':
        runWsId.current = ev.wsId || getSettings().activeId;
        setActiveRunWsId(runWsId.current);
        text.current = '';
        thinking.current = '';
        doneUsage.current = EMPTY_USAGE;
        setStreaming(EMPTY_STREAM);
        setLiveUsage(EMPTY_USAGE);
        setRunning(true);
        game.wake();
        setStatus('Meditating…');
        break;

      case 'session':
        // Main already persisted the session id; mirror it locally.
        if (runWsId.current && ev.sessionId) patchWorkspaceLocal(runWsId.current, { sessionId: ev.sessionId });
        break;

      case 'turn':
        // A model call started: show its already-known input on top of finished calls.
        if (ev.usage) setLiveUsage(addUsage(doneUsage.current, ev.usage));
        break;

      case 'usage':
        if (ev.usage) {
          doneUsage.current = addUsage(doneUsage.current, ev.usage);
          setLiveUsage(doneUsage.current);
        }
        applyUsage(ev);
        break;

      case 'thinking':
        thinking.current += ev.text ?? '';
        setStreaming({ wsId: runWsId.current, text: text.current, thinking: thinking.current });
        setStatus('Meditating…');
        break;

      case 'text':
        flushThinking();
        text.current += ev.text ?? '';
        setStreaming({ wsId: runWsId.current, text: text.current, thinking: '' });
        setStatus('Writing…');
        break;

      case 'tool':
        flush();
        if (runWsId.current) {
          persistMessage(runWsId.current, { kind: 'tool', name: ev.name ?? 'tool', summary: ev.summary });
        }
        game.toolEnemy(ev.name ?? '');
        setStatus(`⚔ ${ev.name}${ev.summary ? `: ${ev.summary}` : ''}`);
        break;

      case 'subagent':
        // Claude delegated to an agent: a known one gets its own tab, others stay ordinary tool lines.
        if (ev.phase === 'event') {
          if (!observe({ ...ev, wsId: ev.wsId || runWsId.current || undefined })) replay(ev);
        } else {
          observe({ ...ev, wsId: ev.wsId || runWsId.current || undefined });
        }
        break;

      case 'result':
        flush();
        if (ev.isError) {
          game.hurt();
          say('Ouch!', 2500);
          setStatus('Something went wrong');
        } else {
          say('Quest complete!', 2500);
          setStatus(`Done in ${Math.round((ev.durationMs || 0) / 1000)}s`);
        }
        if (ev.contextWindow && runWsId.current) {
          patchWorkspaceLocal(runWsId.current, { contextWindow: ev.contextWindow });
        }
        if (ev.costUsd != null && runWsId.current) {
          const tokens = totalTokens(doneUsage.current) > 0 ? ` · ${usageLine(doneUsage.current)}` : '';
          persistMessage(runWsId.current, { kind: 'meta', text: `${ev.turns} turn(s)${tokens} · $${ev.costUsd.toFixed(4)}` });
        }
        break;

      case 'error': {
        flush();
        const target = ev.wsId || runWsId.current || getSettings().activeId;
        if (target) persistMessage(target, { kind: 'error', text: ev.message ?? 'Unknown error' });
        game.hurt();
        setStatus('Error');
        break;
      }

      case 'end':
        flush();
        // A run that ended with an error or was stopped cancels the agents it had delegated to.
        if (runWsId.current) endObserved(runWsId.current, ev.code !== 0);
        runWsId.current = null;
        setActiveRunWsId(null);
        setLiveUsage(null);
        setRunning(false);
        setTimeout(() => { if (!busyRef.current) setStatus('Sleeping'); }, 3000);
        break;

      default:
        break;
    }
  };

  const handleRef = useRef(handle);
  handleRef.current = handle;
  /** What a subagent's inner event looks like when it is not shown as an agent: the same tool line or text as before. */
  const replay = useCallback((ev: ClaudeEvent) => {
    if (ev.phase === 'event' && ev.inner) handleRef.current({ ...ev, type: ev.inner });
  }, []);

  useBridgeEvent<ClaudeEvent>(bar.onClaudeEvent, handle);

  /** Save the user's prompt and start a run in the active workspace. */
  const send = useCallback((wsId: string, prompt: string, model: ModelAlias) => {
    persistMessage(wsId, { kind: 'user', text: prompt });
    bar.send(prompt, model);
  }, [persistMessage]);

  return { running, runWsId: activeRunWsId, streaming, liveUsage, send, stop: () => bar.cancel(), replay };
}
