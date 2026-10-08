import type { WorkspaceStats } from '../types';

export type AchievementTier = 'short' | 'medium' | 'long';

/** What an achievement test can read: all of it persists per workspace. */
export interface AchievementSnapshot {
  kills: number;
  level: number;
  tokens: number;
  trophies: Record<string, { count: number; firstAt: number }>;
  stats: WorkspaceStats;
}

export interface Achievement {
  id: string;
  name: string;
  desc: string;
  tier: AchievementTier;
  test: (s: AchievementSnapshot) => boolean;
}

/** The maps a hero can visit (keep in sync with BACKGROUNDS in engine/heroes.js). */
export const ALL_MAPS = ['forest', 'desert', 'snowy', 'lava', 'night'];

const kills = (n: number) => (s: AchievementSnapshot) => s.kills >= n;
const level = (n: number) => (s: AchievementSnapshot) => s.level >= n;
const combo = (n: number) => (s: AchievementSnapshot) => s.stats.bestCombo >= n;
const crits = (n: number) => (s: AchievementSnapshot) => s.stats.crits >= n;
const agents = (n: number) => (s: AchievementSnapshot) => s.stats.agents >= n;
const bosses = (s: AchievementSnapshot) => Object.keys(s.trophies || {});

// Thresholds are guesses: tune them here. Each id is also allowlisted in main/main.js (npm run check compares them).
export const ACHIEVEMENTS: Achievement[] = [
  // Short term: the first session
  { id: 'first-blood', name: 'First Blood', desc: 'Defeat 1 monster', tier: 'short', test: kills(1) },
  { id: 'warm-up', name: 'Warm-up', desc: 'Defeat 10 monsters', tier: 'short', test: kills(10) },
  { id: 'stage-clear', name: 'Stage Clear', desc: 'Clear a stage (8 kills)', tier: 'short', test: kills(8) },
  { id: 'level-2', name: 'Fresh Recruit', desc: 'Reach level 2', tier: 'short', test: level(2) },
  { id: 'combo-3', name: 'Triple Threat', desc: 'Reach a combo of 3', tier: 'short', test: combo(3) },
  { id: 'first-crit', name: 'Lucky Strike', desc: 'Land a critical hit', tier: 'short', test: crits(1) },
  { id: 'first-agent', name: 'Summoner', desc: 'Start 1 agent', tier: 'short', test: agents(1) },
  // Medium term: days to weeks
  { id: 'kills-100', name: 'Centurion', desc: 'Defeat 100 monsters', tier: 'medium', test: kills(100) },
  { id: 'kills-500', name: 'Warlord', desc: 'Defeat 500 monsters', tier: 'medium', test: kills(500) },
  { id: 'level-10', name: 'Veteran', desc: 'Reach level 10 (weapon glow)', tier: 'medium', test: level(10) },
  { id: 'level-15', name: 'Awakened', desc: 'Reach level 15 (aura)', tier: 'medium', test: level(15) },
  { id: 'combo-5', name: 'Unstoppable', desc: 'Reach a combo of 5', tier: 'medium', test: combo(5) },
  { id: 'crits-100', name: 'Sharp Eye', desc: 'Land 100 critical hits', tier: 'medium', test: crits(100) },
  { id: 'first-boss', name: 'Giant Slayer', desc: 'Defeat a map boss', tier: 'medium', test: (s) => bosses(s).length >= 1 },
  { id: 'agents-10', name: 'Guild Master', desc: 'Start 10 agents', tier: 'medium', test: agents(10) },
  { id: 'maps-all', name: 'World Traveller', desc: 'Visit all 5 maps', tier: 'medium', test: (s) => ALL_MAPS.every((m) => s.stats.mapsSeen.includes(m)) },
  // Long term: months
  { id: 'kills-2500', name: 'Legend', desc: 'Defeat 2,500 monsters', tier: 'long', test: kills(2500) },
  { id: 'kills-10000', name: 'Mythic', desc: 'Defeat 10,000 monsters', tier: 'long', test: kills(10000) },
  { id: 'level-25', name: 'Stormbringer', desc: 'Reach level 25 (lightning)', tier: 'long', test: level(25) },
  { id: 'level-45', name: 'Ascended', desc: 'Reach level 45', tier: 'long', test: level(45) },
  { id: 'bosses-all', name: 'Boss Hunter', desc: 'Fell all 5 map bosses', tier: 'long', test: (s) => bosses(s).length >= 5 },
  { id: 'boss-x10', name: 'Grudge Match', desc: 'Beat the same boss 10 times', tier: 'long', test: (s) => Object.values(s.trophies || {}).some((t) => t.count >= 10) },
  { id: 'agents-100', name: 'Army of Spirits', desc: 'Start 100 agents', tier: 'long', test: agents(100) },
  { id: 'tokens-10m', name: 'Context Hoarder', desc: 'Use 10 million tokens', tier: 'long', test: (s) => s.tokens >= 10_000_000 },
];

export const ACHIEVEMENT_IDS: string[] = ACHIEVEMENTS.map((a) => a.id);

export const EMPTY_STATS: WorkspaceStats = { bestCombo: 0, crits: 0, agents: 0, mapsSeen: [] };

/** Ids whose test passes now and that are not in `already` (never re-locks: earned ones stay earned). */
export function unlocked(snapshot: AchievementSnapshot, already: Record<string, unknown> = {}): string[] {
  return ACHIEVEMENTS.filter((a) => !Object.prototype.hasOwnProperty.call(already, a.id) && a.test(snapshot)).map((a) => a.id);
}
