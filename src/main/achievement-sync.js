// One-time sync of boss badges with the trophy shelf (migrations.achievementSyncV1). Pure: no electron import,
// tools/check-achievement-sync.mjs tests it. The trophy rules mirror lib/achievements.ts (npm run check compares them).
// It only removes achievement keys whose evidence (the project's CURRENT trophies) is missing; trophies, other
// badges and lifetime stats are never touched, and badges earned after the trophy resets stay (their trophies exist).

const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const MAP_BOSS_IDS = ['boss:forest', 'boss:desert', 'boss:snowy', 'boss:lava', 'boss:night'];

const countOf = (trophies, id) => {
  const t = has(trophies, id) ? trophies[id] : null;
  return t && Number.isFinite(t.count) ? t.count : 0;
};
const mapBossCount = (trophies) => MAP_BOSS_IDS.filter((id) => countOf(trophies, id) >= 1).length;

// Same tests as the table in lib/achievements.ts, on a trophies object ({ "boss:x": { count } }).
const TROPHY_RULES = {
  'first-boss': (t) => mapBossCount(t) >= 1,
  'bosses-all': (t) => mapBossCount(t) >= 5,
  'boss-x3': (t) => Object.keys(t).some((id) => countOf(t, id) >= 3),
  'dragon-slayer': (t) => countOf(t, 'boss:legendary') >= 1,
};
// Removed from the table (replaced by boss-x3): deleted from every project.
const RETIRED = ['boss-x10'];
// Badges that existed before this migration and are re-checked against the current trophies.
const RECHECKED = ['first-boss', 'bosses-all'];

/** Returns { workspaces, changed } where changed = number of badges removed. Never mutates the input. */
function syncAchievements(workspaces) {
  let changed = 0;
  const out = (Array.isArray(workspaces) ? workspaces : []).map((w) => {
    const ach = w && w.achievements && typeof w.achievements === 'object' && !Array.isArray(w.achievements) ? w.achievements : null;
    if (!ach) return w;
    const trophies = w.trophies && typeof w.trophies === 'object' && !Array.isArray(w.trophies) ? w.trophies : {};
    const drop = new Set(RETIRED.filter((id) => has(ach, id)));
    for (const id of RECHECKED) if (has(ach, id) && !TROPHY_RULES[id](trophies)) drop.add(id);
    if (!drop.size) return w;
    changed += drop.size;
    const next = {};
    for (const key of Object.keys(ach)) if (!drop.has(key)) Object.defineProperty(next, key, { value: ach[key], enumerable: true, writable: true, configurable: true });
    return { ...w, achievements: next };
  });
  return { workspaces: out, changed };
}

module.exports = { TROPHY_RULES, RETIRED, syncAchievements };
