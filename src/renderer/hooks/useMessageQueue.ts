import { useCallback, useMemo, useRef, useState } from 'react';
import { clearQueue, enqueue, removeItem, takeNext } from '../lib/queue';
import type { QueuedMessage, Queues } from '../lib/queue';

interface QueueState {
  queues: Queues;
  /** Workspaces whose queue does not send by itself (after Stop or a failed run). */
  paused: Record<string, boolean>;
}

export interface MessageQueue {
  /** Changes on every queue operation (effect dependency). */
  state: QueueState;
  /** false at the cap (nothing queued). */
  add: (wsId: string, text: string) => boolean;
  remove: (wsId: string, id: string) => void;
  clear: (wsId: string) => void;
  /** Removes and returns the oldest message. Synchronous, so it can never be taken twice. */
  take: (wsId: string) => QueuedMessage | null;
  pause: (wsId: string) => void;
  resume: (wsId: string) => void;
  items: (wsId: string) => QueuedMessage[];
  isPaused: (wsId: string) => boolean;
}

const NONE: QueuedMessage[] = [];

/**
 * Messages typed in the Expedition chat while Claude is busy, per workspace, in memory only.
 * It knows nothing about Claude: `App.tsx` decides when to take the next one.
 * The ref is the source of truth (async code reads it at once); the state only triggers renders.
 */
export function useMessageQueue(): MessageQueue {
  const ref = useRef<QueueState>({ queues: {}, paused: {} });
  const [state, setState] = useState<QueueState>(ref.current);

  const update = useCallback((fn: (s: QueueState) => QueueState) => {
    const next = fn(ref.current);
    if (next === ref.current) return;
    // A queue that became empty is not paused any more, so the flag cannot linger.
    const paused: Record<string, boolean> = {};
    for (const id of Object.keys(next.paused)) if (next.paused[id] && next.queues[id]?.length) paused[id] = true;
    ref.current = { queues: next.queues, paused };
    setState(ref.current);
  }, []);

  return useMemo<MessageQueue>(() => ({
    state,
    add: (wsId, text) => {
      const r = enqueue(ref.current.queues, wsId, text, crypto.randomUUID());
      if (r.ok) update((s) => ({ ...s, queues: r.queues }));
      return r.ok;
    },
    remove: (wsId, id) => update((s) => ({ ...s, queues: removeItem(s.queues, wsId, id) })),
    clear: (wsId) => update((s) => ({ ...s, queues: clearQueue(s.queues, wsId) })),
    take: (wsId) => {
      const r = takeNext(ref.current.queues, wsId);
      if (r.item) update((s) => ({ ...s, queues: r.queues }));
      return r.item;
    },
    pause: (wsId) => update((s) => (s.paused[wsId] ? s : { ...s, paused: { ...s.paused, [wsId]: true } })),
    resume: (wsId) => update((s) => (s.paused[wsId] ? { ...s, paused: { ...s.paused, [wsId]: false } } : s)),
    items: (wsId) => ref.current.queues[wsId] ?? NONE,
    isPaused: (wsId) => !!ref.current.paused[wsId],
  }), [state, update]);
}
