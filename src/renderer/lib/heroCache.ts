import { generateHero } from '../engine/heroes.js';
import { heroPortrait } from '../engine/sprite.js';
import type { Hero, Workspace } from '../types';

// A workspace stores only a hero seed; the hero and its portrait are derived
// from it. Both are cached because generating them is not free.

const heroes = new Map<string, Hero>();
const portraits = new Map<string, string>();

/** The deterministic hero for a workspace (null when there is no workspace). */
export function heroFor(ws: Workspace): Hero;
export function heroFor(ws: Workspace | null): Hero | null;
export function heroFor(ws: Workspace | null): Hero | null {
  if (!ws) return null;
  if (!heroes.has(ws.heroSeed)) heroes.set(ws.heroSeed, generateHero(ws.heroSeed) as Hero);
  return heroes.get(ws.heroSeed) as Hero;
}

/** Portrait data URL for a workspace's hero. */
export function portraitFor(ws: Workspace): string {
  if (!portraits.has(ws.heroSeed)) portraits.set(ws.heroSeed, heroPortrait(heroFor(ws)));
  return portraits.get(ws.heroSeed) as string;
}
