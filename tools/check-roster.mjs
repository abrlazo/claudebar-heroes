// Pure checks for the summon roster (engine/heroes.js) and the hero design validator (main/hero-design.js).
// Usage: npm run check   (exit code 1 if anything fails)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// heroes.js is an ES module inside a CommonJS package: load a copy with an .mjs extension.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-roster-'));
fs.copyFileSync(path.join(root, 'src/renderer/engine/heroes.js'), path.join(tmp, 'heroes.mjs'));
const { CHARACTERS, RIG, findSummon, generateHero } = await import(pathToFileURL(path.join(tmp, 'heroes.mjs')).href);
fs.copyFileSync(path.join(root, 'src/renderer/engine/boss.js'), path.join(tmp, 'boss.mjs'));
const { BOSS_CHANCE, bossChance, rollBoss, stageKey } = await import(pathToFileURL(path.join(tmp, 'boss.mjs')).href);
fs.rmSync(tmp, { recursive: true, force: true });
const design = createRequire(import.meta.url)(path.join(root, 'src/main/hero-design.js'));

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
const HEX = /^#[0-9a-f]{6}$/i;
const NAME = /^[a-z0-9][a-z0-9 '.-]{0,39}$/;

// ----- roster -----
const gearOk = (g) => RIG.gear.includes(g) || g === 'vader';
check('every character has a plain lower-case first name (it becomes the seed)', CHARACTERS.every((c) => c.seed || NAME.test(c.names[0])));
const aliases = CHARACTERS.flatMap((c) => c.names);
check('no alias is shared by two characters', new Set(aliases).size === aliases.length);
check('every weapon, body, gear and hair is one the rig can draw', CHARACTERS.every(({ hero: h }) =>
  RIG.weapon.includes(h.weapon) && RIG.body.includes(h.body) && gearOk(h.gear) && RIG.hair.includes(h.hair)));
check('every colour is #rrggbb and all eight are set', CHARACTERS.every(({ hero: h }) =>
  RIG.colors.every((k) => HEX.test(h.colors[k])) && (!h.signatureGlow || HEX.test(h.signatureGlow))));
check('stats are whole numbers from 80 to 175', CHARACTERS.every(({ hero: h }) => Object.values(h.stats).every((v) => Number.isInteger(v) && v >= 80 && v <= 175)));
check('findSummon("please summon spider-man!")', findSummon('please summon spider-man!')?.seed === 'summon:spider-man');
check('findSummon("summon Mario")', findSummon('summon Mario')?.seed === 'summon:mario');
check('the longer alias wins: "summon cloud strife"', findSummon('summon cloud strife')?.name === 'Cloud Strife');
check('"summon Yoda" is famous, "summon Zorblax" is not', findSummon('summon Yoda')?.famous === true && findSummon('summon Zorblax')?.famous === false);
check('every character is found by each of its aliases and builds a secret hero', CHARACTERS.every((c) => c.names.every((a) => {
  const found = findSummon(`summon ${a}`);
  return found && generateHero(found.seed).secret === true && generateHero(found.seed).name === c.hero.name;
})));
check('designs can use the same gear as the rig, except vader', !RIG.gear.includes('vader'));

// ----- the validator's allowlists match the renderer's -----
for (const key of Object.keys(RIG)) check(`hero-design.js "${key}" list matches heroes.js`, JSON.stringify(design.RIG[key]) === JSON.stringify(RIG[key]));

// ----- validateDesign -----
const good = () => ({
  cls: 'Ninja', weapon: 'daggers', body: 'gi', gear: 'headband', hair: 'spiky', shield: false, cape: true,
  colors: { skin: '#f3c9a6', hair: '#f5d142', primary: '#ff7a00', secondary: '#1e3a8a', accent: '#3b5ba5', pants: '#ff7a00', boots: '#1e3a8a', metal: '#cfd8e3' },
  stats: { hp: 140, atk: 150, def: 100, spd: 130 },
});
const run = (mutate) => { const d = good(); mutate(d); return design.validateDesign(d); };
check('a valid design passes', design.validateDesign(good()).ok);
check('unknown weapon is rejected', !run((d) => { d.weapon = 'lightsaber'; }).ok);
check('gear "vader" is rejected', !run((d) => { d.gear = 'vader'; }).ok);
check('a colour name is rejected', !run((d) => { d.colors.skin = 'red'; }).ok);
check('a short hex is rejected', !run((d) => { d.colors.skin = '#fff'; }).ok);
check('url(x) as a colour is rejected', !run((d) => { d.colors.skin = 'url(x)'; }).ok);
check('a missing colour is rejected', !run((d) => { delete d.colors.metal; }).ok);
check('cls with <script> is rejected', !run((d) => { d.cls = '<script>x</script>'; }).ok);
check('non-objects are rejected', [[], 'text', null, 5, undefined].every((v) => !design.validateDesign(v).ok));
check('more than 1500 characters is rejected', !run((d) => { d.padding = 'x'.repeat(1600); }).ok);
const extra = JSON.parse('{"__proto__":{"polluted":1},"name":"Evil","evil":{"x":1}}');
const withExtra = design.validateDesign({ ...good(), ...extra });
check('extra keys (name, __proto__, others) are dropped', withExtra.ok && !('name' in withExtra.design) && !('evil' in withExtra.design) && !({}).polluted);
const big = run((d) => { d.stats = { hp: 999, atk: 999, def: 999, spd: 999 }; });
const total = big.ok ? Object.values(big.design.stats).reduce((a, b) => a + b, 0) : 0;
check('stats are clamped (999 becomes 175) and capped at a total of 560', big.ok && total <= 560 && Object.values(big.design.stats).every((v) => v >= 80 && v <= 175), JSON.stringify(big.design?.stats));
check('non-numeric stats are rejected', !run((d) => { d.stats.hp = '999'; }).ok);
check('flags are strict booleans', run((d) => { d.shield = 'true'; d.stache = 1; }).design.shield === false);
check('a near-black colour is lightened off the outline colour', run((d) => { d.colors.primary = '#141420'; }).design.colors.primary !== '#141420');
check('colours come out lower-case', run((d) => { d.colors.skin = '#F3C9A6'; }).design.colors.skin === '#f3c9a6');
check('signatureGlow is dropped for fists', run((d) => { d.weapon = 'fists'; d.signatureGlow = '#ff0000'; }).design.signatureGlow === undefined);
check('signatureGlow is kept for a weapon', run((d) => { d.signatureGlow = '#ff0000'; }).design.signatureGlow === '#ff0000');
check('designFor ignores inherited keys ("constructor")', design.designFor({}, 'constructor') === null);
let many = {};
for (let i = 0; i < 60; i++) many = design.rememberDesign(many, `n${i}`, { ...good(), at: 0 });
check('rememberDesign keeps at most 50', Object.keys(many).length === design.MAX_DESIGNS);
check('the prompt carries the name as a JSON string', design.designPrompt('zor "x"').includes('"zor \\"x\\""'));
check('parseDesignText finds JSON inside code fences', design.parseDesignText('text\n```json\n{"a":1}\n```')?.a === 1 && design.parseDesignText('no json') === null);

// ----- rare bosses (engine/boss.js) -----
check('boss: BOSS_CHANCE is 5%', BOSS_CHANCE === 0.05);
check('boss: chance 0 never rolls a boss, chance 1 always does', Array.from({ length: 1000 }, () => rollBoss(0)).every((r) => r === false) && Array.from({ length: 1000 }, () => rollBoss(1)).every((r) => r === true));
check('boss: the roll is "random < chance"', rollBoss(undefined, () => 0.049) === true && rollBoss(undefined, () => 0.05) === false);
let hits = 0;
for (let i = 0; i < 200000; i++) if (rollBoss()) hits++;
check('boss: 200000 default rolls hit about 5%', hits / 200000 > 0.045 && hits / 200000 < 0.055, `${(hits / 2000).toFixed(2)}%`);
const badSeams = [2, -0.1, '1', NaN, Infinity, null, {}];
check('boss: the test seam ignores anything that is not a number in [0,1]', badSeams.every((v) => { globalThis.__cbhBossChance = v; return bossChance() === BOSS_CHANCE; }));
globalThis.__cbhBossChance = 0.5;
check('boss: the test seam accepts 0.5 and 0', bossChance() === 0.5 && (globalThis.__cbhBossChance = 0, bossChance() === 0));
delete globalThis.__cbhBossChance;
check('boss: the stage key changes with the map and every 8 kills', stageKey('forest', 7, 8) === 'forest:0' && stageKey('forest', 8, 8) === 'forest:1' && stageKey('desert', 7, 8) !== stageKey('forest', 7, 8));

console.log(failed ? `\n${failed} check(s) failed` : '\nAll roster checks passed');
process.exit(failed ? 1 : 0);
