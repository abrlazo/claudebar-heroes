// Rare map bosses: pure roll helpers (no imports, so tools/check-roster.mjs can load a copy).

export const BOSS_CHANCE = 0.05;

/**
 * Chance used at roll time. `globalThis.__cbhBossChance` is a test seam that only renderer JS
 * (a CDP evaluate in the simulation) can set; it never comes from settings, IPC or preload.
 */
export function bossChance() {
  const v = globalThis.__cbhBossChance;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : BOSS_CHANCE;
}

export function rollBoss(chance = bossChance(), rng = Math.random) {
  return rng() < chance;
}

/** One roll per stage: a stage is `perMap` kills on one map. */
export const stageKey = (mapId, kills, perMap) => `${mapId}:${Math.floor(kills / perMap)}`;
