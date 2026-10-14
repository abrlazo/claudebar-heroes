// Pure rules for the Expedition message queue (messages typed while Claude's run is busy).
// Every function returns new objects (React state) and never mutates its input.

export const MAX_QUEUED = 5;

/** An attached image: the id main staged it under and the small thumbnail main made (no original bytes live in the renderer). */
export interface AttachedImage { id: string; thumb: string }
export interface QueuedMessage { id: string; text: string; images?: AttachedImage[] }
export type Queues = Record<string, QueuedMessage[]>;

const withList = (queues: Queues, wsId: string, list: QueuedMessage[]): Queues => {
  const next = { ...queues };
  if (list.length) next[wsId] = list;
  else delete next[wsId];
  return next;
};

/** Appends a message to a workspace's queue. `ok` is false (nothing changed) at the cap, or for blank text without images. */
export function enqueue(queues: Queues, wsId: string, text: string, id: string, images: AttachedImage[] = []): { queues: Queues; ok: boolean } {
  const value = text.trim();
  const list = queues[wsId] ?? [];
  if ((!value && images.length === 0) || list.length >= MAX_QUEUED) return { queues, ok: false };
  const item: QueuedMessage = images.length ? { id, text: value, images: [...images] } : { id, text: value };
  return { queues: withList(queues, wsId, [...list, item]), ok: true };
}

/** The staged image ids held by these messages (to discard when they are removed). */
export const imageIdsOf = (items: readonly QueuedMessage[]): string[] => items.flatMap((m) => (m.images ?? []).map((i) => i.id));

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
