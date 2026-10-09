// Pure rules for the Expedition message queue (messages typed while Claude's run is busy).
// Every function returns new objects (React state) and never mutates its input.

export const MAX_QUEUED = 5;

export interface QueuedMessage { id: string; text: string }
export type Queues = Record<string, QueuedMessage[]>;

const withList = (queues: Queues, wsId: string, list: QueuedMessage[]): Queues => {
  const next = { ...queues };
  if (list.length) next[wsId] = list;
  else delete next[wsId];
  return next;
};

/** Appends a message to a workspace's queue. `ok` is false (nothing changed) at the cap or for blank text. */
export function enqueue(queues: Queues, wsId: string, text: string, id: string): { queues: Queues; ok: boolean } {
  const value = text.trim();
  const list = queues[wsId] ?? [];
  if (!value || list.length >= MAX_QUEUED) return { queues, ok: false };
  return { queues: withList(queues, wsId, [...list, { id, text: value }]), ok: true };
}

export function removeItem(queues: Queues, wsId: string, id: string): Queues {
  const list = queues[wsId] ?? [];
  if (!list.some((m) => m.id === id)) return queues;
  return withList(queues, wsId, list.filter((m) => m.id !== id));
}

/** Takes the oldest message (FIFO). */
export function takeNext(queues: Queues, wsId: string): { queues: Queues; item: QueuedMessage | null } {
  const list = queues[wsId] ?? [];
  if (!list.length) return { queues, item: null };
  return { queues: withList(queues, wsId, list.slice(1)), item: list[0] };
}

export function clearQueue(queues: Queues, wsId: string): Queues {
  return queues[wsId] ? withList(queues, wsId, []) : queues;
}
