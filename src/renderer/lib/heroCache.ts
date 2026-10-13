import { generateHero } from '../engine/heroes.js';
import { heroPortrait } from '../engine/sprite.js';
import type { Hero, Workspace } from '../types';

// A workspace stores only a hero seed; the hero and its portrait are derived
// from it. Both are cached because generating them is not free.

const heroes = new Map<string, Hero>();
const portraits = new Map<string, string>();
// Every summon or reroll makes a new key, so the caches are LRU-capped instead of growing for the whole session.
const MAX_CACHED = 64;

function cached<T>(map: Map<string, T>, key: string, make: () => T): T {
  let v = map.get(key);
  if (v !== undefined) {
    map.delete(key); // most recently used goes last
  } else {
    v = make();
    if (map.size >= MAX_CACHED) map.delete(map.keys().next().value as string);
  }
  map.set(key, v);
  return v;
}

// A design that arrives after the seed changes the look, so it is part of the key.
const cacheKey = (ws: Workspace) => (ws.heroDesign ? `${ws.heroSeed}#${ws.heroDesign.at}` : ws.heroSeed);

/** The deterministic hero for a workspace (null when there is no workspace). */
export function heroFor(ws: Workspace): Hero;
export function heroFor(ws: Workspace | null): Hero | null;
export function heroFor(ws: Workspace | null): Hero | null {
  if (!ws) return null;
  return cached(heroes, cacheKey(ws), () => generateHero(ws.heroSeed, ws.heroDesign ?? undefined) as Hero);
}

/** Portrait data URL for a workspace's hero. */
export function portraitFor(ws: Workspace): string {
  return cached(portraits, cacheKey(ws), () => heroPortrait(heroFor(ws)));
}
