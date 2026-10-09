// Rare bosses: pure roll helpers (no imports, so tools/check-roster.mjs can load a copy).

export const BOSS_CHANCE = 0.01;        // a stage's 8th fight is the map's boss
export const LEGENDARY_CHANCE = 0.003;  // ... or the legendary dragon (never both: one roll)

const validChance = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * Map boss chance used at roll time. `globalThis.__cbhBossChance` is a test seam that only renderer
 * JS (a CDP evaluate in the simulation) can set; it never comes from settings, IPC or preload.
 */
export function bossChance() {
  const v = globalThis.__cbhBossChance;
  return validChance(v) ? v : BOSS_CHANCE;
}

/**
 * Legendary chance. Seam `globalThis.__cbhLegendaryChance` wins; when only `__cbhBossChance` is set
 * the legendary is off (0), so tests that force or forbid the map boss stay deterministic.
 */
export function legendaryChance() {
  const v = globalThis.__cbhLegendaryChance;
  if (validChance(v)) return v;
  return validChance(globalThis.__cbhBossChance) ? 0 : LEGENDARY_CHANCE;
}

/** ONE roll: 'legendary', 'map' or 'none' (mutually exclusive by construction). */
export function rollBossKind(rng = Math.random, mapChance = bossChance(), legendChance = legendaryChance()) {
  const r = rng();
  if (r < legendChance) return 'legendary';
  return r < legendChance + mapChance ? 'map' : 'none';
}

/** One roll per stage: a stage is `perMap` kills on one map. */
export const stageKey = (mapId, kills, perMap) => `${mapId}:${Math.floor(kills / perMap)}`;
