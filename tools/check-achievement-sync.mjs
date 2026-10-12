// Checks the one-time boss-badge sync: the pure rules (main/achievement-sync.js) and load() in settings.js with a stubbed electron.
// Usage: npm run check   (exit code 1 if anything fails)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { syncAchievements } = require(path.join(root, 'src/main/achievement-sync.js'));

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  achievement-sync: ${name}${detail ? `  (${detail})` : ''}`); };
const keys = (w) => Object.keys(w.achievements).sort().join(',');
const A = (...ids) => Object.fromEntries(ids.map((id) => [id, { at: 1 }]));
const T = (o) => Object.fromEntries(Object.entries(o).map(([k, count]) => [k, { count, firstAt: 1 }]));
const ws = (extra) => ({ id: 'w', kills: 77, stats: { bestCombo: 3, crits: 9, agents: 12, mapsSeen: ['forest'] }, usage: { input: 1 }, trophies: {}, achievements: {}, ...extra });

// ----- pure rules -----
{
  const input = [ws({ achievements: A('first-boss', 'bosses-all', 'boss-x10', 'kills-100', 'agents-10') })];
  const r = syncAchievements(input);
  const w = r.workspaces[0];
  check('an empty shelf drops every boss badge and keeps the others', keys(w) === 'agents-10,kills-100' && r.changed === 3, keys(w));
  check('stats, kills, usage and trophies are untouched', w.kills === 77 && w.stats.crits === 9 && w.usage.input === 1 && JSON.stringify(w.trophies) === '{}' && w.achievements['kills-100'].at === 1);
  check('the input is not mutated', keys(input[0]) === 'agents-10,bosses-all,boss-x10,first-boss,kills-100'.split(',').sort().join(','));
  const again = syncAchievements(r.workspaces);
  check('a second run changes nothing', again.changed === 0 && keys(again.workspaces[0]) === 'agents-10,kills-100');
}
{
  const w = syncAchievements([ws({ trophies: T({ 'boss:snowy': 1 }), achievements: A('first-boss', 'bosses-all') })]);
  check('a real map trophy keeps Giant Slayer, Boss Hunter without all five goes', keys(w.workspaces[0]) === 'first-boss' && w.changed === 1);
  const all = T(Object.fromEntries(['forest', 'desert', 'snowy', 'lava', 'night'].map((m) => [`boss:${m}`, 1])));
  const f = syncAchievements([ws({ trophies: all, achievements: A('first-boss', 'bosses-all') })]);
  check('five map trophies keep both', keys(f.workspaces[0]) === 'bosses-all,first-boss' && f.changed === 0);
  const d = syncAchievements([ws({ trophies: T({ 'boss:legendary': 1 }), achievements: A('first-boss', 'dragon-slayer', 'boss-x3') })]);
  check('only the dragon drops Giant Slayer; Dragon Slayer and Grudge Match are never removed', keys(d.workspaces[0]) === 'boss-x3,dragon-slayer' && d.changed === 1);
  const x = syncAchievements([ws({ trophies: T({ 'boss:lava': 12 }), achievements: A('boss-x10') })]);
  check('boss-x10 is always dropped', keys(x.workspaces[0]) === '' && x.changed === 1);
}
{
  const evil = JSON.parse('{"__proto__":{"at":1},"first-boss":{"at":1},"weird":{"at":2}}');
  let ok = true; let r;
  try { r = syncAchievements([ws({ achievements: evil, trophies: JSON.parse('{"__proto__":{"count":9}}') }), null, { id: 'x' }, ws({ achievements: [] })]); } catch { ok = false; }
  check('__proto__, unknown keys, null and odd workspaces do not break it', ok && keys(r.workspaces[0]) === '__proto__,weird' && ({}).at === undefined && r.changed === 1, ok ? keys(r.workspaces[0]) : 'threw');
  check('a non-array input gives an empty result', syncAchievements(undefined).workspaces.length === 0);
}

// ----- settings.js load() with a stubbed electron -----
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-achsync-'));
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') return { app: { getPath: () => userData } };
  return origLoad.call(this, request, ...rest);
};
const settingsPath = path.join(root, 'src/main/settings.js');
const fresh = () => { delete require.cache[settingsPath]; return require(settingsPath); };
const file = path.join(userData, 'settings.json');
const disk = () => JSON.parse(fs.readFileSync(file, 'utf8'));
const base = (id, extra) => ({ id, path: '/tmp/' + id, name: id, heroSeed: id, kills: 40, map: 'forest', usage: { input: 5, output: 0, cacheRead: 0, cacheCreate: 0 }, messages: [], ...extra });
try {
  fs.writeFileSync(file, JSON.stringify({
    activeId: 'a', migrations: { trophyResetV1: true, trophyResetV2: true },
    workspaces: [
      base('a', { achievements: A('first-boss', 'bosses-all', 'boss-x10', 'kills-100'), stats: { bestCombo: 4, crits: 8, agents: 2, mapsSeen: ['forest'] } }),
      base('b', { trophies: T({ 'boss:snowy': 1 }), achievements: A('first-boss', 'bosses-all', 'kills-100') }),
    ],
  }));
  let st = fresh();
  let s = st.get();
  const a = s.workspaces.find((w) => w.id === 'a'); const b = s.workspaces.find((w) => w.id === 'b');
  check('load drops the boss badges of the empty shelf, keeps the others and the stats', keys(a) === 'kills-100' && a.stats.crits === 8 && a.kills === 40, keys(a));
  check('a project with a real trophy keeps Giant Slayer and its trophy', keys(b) === 'first-boss,kills-100' && b.trophies['boss:snowy'].count === 1, keys(b));
  const d1 = disk();
  check('the markers are on disk at once (no debounce wait)', d1.migrations.achievementSyncV1 === true && d1.migrations.achievementSyncNotice === true && !d1.workspaces[0].achievements['first-boss']);
  check('the notice can only be cleared through its own call; other names are refused', (st.markMigration('achievementSyncV1'), st.markMigration('whatever'), !('whatever' in st.get().migrations)) && st.get().migrations.achievementSyncNotice === true);
  st.clearAchievementSyncNotice();
  check('clearing the notice keeps the marker and is on disk', disk().migrations.achievementSyncV1 === true && !('achievementSyncNotice' in disk().migrations));
  st.addTrophy('a', 'boss:legendary');
  st.addAchievement('a', 'dragon-slayer');
  st.addAchievement('a', 'first-boss'); // as if earned after the resets
  fs.writeFileSync(file, JSON.stringify({ ...st.get() })); // what a later flush writes
  st = fresh(); s = st.get();
  const a2 = s.workspaces.find((w) => w.id === 'a');
  check('a restart does not run it again: badges earned later stay, the notice stays off, the trophy survives',
    keys(a2) === 'dragon-slayer,first-boss,kills-100' && a2.trophies['boss:legendary'].count === 1 && !('achievementSyncNotice' in s.migrations), keys(a2));
  // Already migrated file with boss badges: not touched.
  fs.writeFileSync(file, JSON.stringify({ activeId: 'a', migrations: { trophyResetV1: true, trophyResetV2: true, achievementSyncV1: true }, workspaces: [base('a', { achievements: A('first-boss', 'boss-x10') })] }));
  st = fresh(); s = st.get();
  check('a file with achievementSyncV1 already set is not touched', keys(s.workspaces[0]) === 'boss-x10,first-boss' && !('achievementSyncNotice' in s.migrations));
  // Fresh install / nothing removed: marker set, no notice.
  fs.writeFileSync(file, JSON.stringify({ workspaces: [base('a', { achievements: A('kills-100') })] }));
  st = fresh(); s = st.get();
  check('an old install with nothing to remove gets the marker but no notice', s.migrations.achievementSyncV1 === true && !('achievementSyncNotice' in s.migrations) && keys(s.workspaces[0]) === 'kills-100');
  fs.rmSync(file);
  st = fresh(); s = st.get();
  check('a fresh install gets the marker and no notice', s.migrations.achievementSyncV1 === true && !('achievementSyncNotice' in s.migrations));
} catch (e) {
  failed++; console.log('FAIL  achievement-sync: integration threw', e);
} finally {
  Module._load = origLoad;
  fs.rmSync(userData, { recursive: true, force: true });
}

console.log(failed ? `\n${failed} check(s) failed` : '\nAll achievement-sync checks passed');
process.exit(failed ? 1 : 0);
