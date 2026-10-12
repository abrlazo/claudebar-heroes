/** Keep equal to MAX_MESSAGES in main/settings.js (main drops the oldest the same way). */
export const MAX_MESSAGES = 500;

/** `list` plus `item`, keeping only the newest `max` entries. Never mutates `list`. */
export function appendCapped<T>(list: readonly T[] | undefined, item: T, max = MAX_MESSAGES): T[] {
  const next = [...(list ?? []), item];
  return next.length > max ? next.slice(next.length - max) : next;
}
