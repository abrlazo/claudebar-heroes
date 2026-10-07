import { generateHero } from '../engine/heroes.js';
import { heroPortrait } from '../engine/sprite.js';
import type { Hero, Workspace } from '../types';

// A workspace stores only a hero seed; the hero and its portrait are derived
// from it. Both are cached because generating them is not free.

const heroes = new Map<string, Hero>();
const portraits = new Map<string, string>();

// A design that arrives after the seed changes the look, so it is part of the key.
const cacheKey = (ws: Workspace) => (ws.heroDesign ? `${ws.heroSeed}#${ws.heroDesign.at}` : ws.heroSeed);

/** The deterministic hero for a workspace (null when there is no workspace). */
export function heroFor(ws: Workspace): Hero;
export function heroFor(ws: Workspace | null): Hero | null;
export function heroFor(ws: Workspace | null): Hero | null {
  if (!ws) return null;
  const key = cacheKey(ws);
  if (!heroes.has(key)) heroes.set(key, generateHero(ws.heroSeed, ws.heroDesign ?? undefined) as Hero);
  return heroes.get(key) as Hero;
}

/** Portrait data URL for a workspace's hero. */
export function portraitFor(ws: Workspace): string {
  const key = cacheKey(ws);
  if (!portraits.has(key)) portraits.set(key, heroPortrait(heroFor(ws)));
  return portraits.get(key) as string;
}
