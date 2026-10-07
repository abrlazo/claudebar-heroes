import type { Usage, Workspace } from '../types';

// Heroes level up from the context Claude uses in their workspace:
// 1 XP per 1,000 tokens. Cached context counts at 10% (like its price),
// so re-reading the same conversation doesn't inflate XP.

/** Level reached with `xp` experience points. */
export const levelFor = (xp: number): number => Math.floor(Math.sqrt(xp / 50)) + 1;

/** XP needed to reach `lvl`. */
export const xpForLevel = (lvl: number): number => 50 * (lvl - 1) ** 2;

/** Lifetime XP derived from a token usage (a workspace works too). */
export function xpFor(source: { usage?: Usage }): number {
  const u: Partial<Usage> = source.usage || {};
  return Math.floor(((u.input || 0) + (u.cacheCreate || 0) + (u.output || 0) + 0.1 * (u.cacheRead || 0)) / 1000);
}

/** Sum of all token buckets in a usage object. */
export const totalTokens = (u: Partial<Usage> = {}): number =>
  (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheCreate || 0);

/** Percent (0-100) of the context window left. Hero stats scale with it: 100% on a fresh context. */
export const vigorPct = (ws: Pick<Workspace, 'lastContext' | 'contextWindow'>): number =>
  100 - contextPct(ws);

/** Percent (0-100) of the context window used by the last model call. */
export const contextPct = (ws: Pick<Workspace, 'lastContext' | 'contextWindow'>): number =>
  Math.min(100, Math.round((ws.lastContext / (ws.contextWindow || 200000)) * 100));
