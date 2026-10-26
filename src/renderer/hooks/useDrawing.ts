import { useCallback, useRef, useState } from 'react';
import { bar } from '../lib/bridge';
import type { ChatMessage } from '../types';

/** Where a drawing lands: a project's Expedition chat (by id, so switching project mid-draw is safe) or the Ask chat. */
export type DrawTarget = { kind: 'quest'; wsId: string } | { kind: 'ask' };

export interface PendingDrawing {
  target: DrawTarget;
  caption: string;
}

export interface DrawingApi {
  pending: PendingDrawing | null;
  /** Starts one drawing; `userText` is the typed line, which goes into the chat first. */
  start: (target: DrawTarget, description: string, userText: string) => void;
  cancel: () => void;
}

/**
 * `/draw`: one drawing at a time. Main asks Claude, validates the grid and answers; this hook only shows the
 * pending row and delivers the result (an `art` message, or a fixed meta line) to the chat that asked.
 * It is not a run: no hero, queue, notification or usage is involved.
 */
export function useDrawing(deliver: (target: DrawTarget, message: ChatMessage) => void): DrawingApi {
  const [pending, setPending] = useState<PendingDrawing | null>(null);
  const busy = useRef(false);

  const start = useCallback((target: DrawTarget, description: string, userText: string) => {
    deliver(target, { kind: 'user', text: userText });
    if (busy.current) {
      deliver(target, { kind: 'meta', text: 'Already drawing, wait for it.' });
      return;
    }
    busy.current = true;
    setPending({ target, caption: description.slice(0, 80) });
    void (async () => {
      try {
        const res = await bar.makeDrawing(description);
        if (res.ok) deliver(target, { kind: 'art', text: res.caption, art: res.art });
        else deliver(target, { kind: 'meta', text: res.message });
      } catch {
        deliver(target, { kind: 'meta', text: 'Claude could not draw that.' });
      } finally {
        busy.current = false;
        setPending(null);
      }
    })();
  }, [deliver]);

  return { pending, start, cancel: () => bar.cancelDrawing() };
}
