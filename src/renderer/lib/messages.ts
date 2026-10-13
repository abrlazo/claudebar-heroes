/** Keep equal to MAX_MESSAGES in main/settings.js (main drops the oldest the same way). */
export const MAX_MESSAGES = 500;

/** `list` plus `item`, keeping only the newest `max` entries. Never mutates `list`. */
export function appendCapped<T>(list: readonly T[] | undefined, item: T, max = MAX_MESSAGES): T[] {
  const next = [...(list ?? []), item];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * An agent's in-memory log plus `item`, capped like the chat. Its first entry (the task) is always kept,
 * so a long-running agent cannot grow without bound but its tab still opens with what it was asked to do.
 */
export function appendLog<T>(list: readonly T[], item: T, max = MAX_MESSAGES): T[] {
  if (list.length + 1 <= max) return [...list, item];
  return [list[0], ...list.slice(list.length - max + 2), item];
}

// Chat rows are keyed by message identity, not index, so dropping the oldest message (the cap) does not remount the rest.
const rowKeys = new WeakMap<object, number>();
let nextRowKey = 0;

/** A stable React key for a chat message object. */
export function rowKey(m: object): number {
  let key = rowKeys.get(m);
  if (key === undefined) { key = ++nextRowKey; rowKeys.set(m, key); }
  return key;
}

/** `next` replaces `prev` (streamed text appended to it): it keeps the row, so it is updated in place, not remounted. */
export function keepRowKey<T extends object>(prev: object, next: T): T {
  rowKeys.set(next, rowKey(prev));
  return next;
}
