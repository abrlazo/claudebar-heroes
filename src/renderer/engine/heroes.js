// Procedural hero generator. Every imported workspace gets a random seed, and
// the seed decides everything about its hero: class, colours, hair,
// headgear, weapon, name and stats. Same seed → same hero, forever.

export const BACKGROUNDS = [
  { id: 'forest', name: 'Forest' },
  { id: 'desert', name: 'Desert' },
  { id: 'snowy', name: 'Snowy' },
  { id: 'lava', name: 'Lava' },
  { id: 'night', name: 'Night' },
];

const CLASSES = {
  warrior: { title: 'Warrior', weapon: 'sword', gear: ['helmet', 'headband', 'none'], body: 'armor', bias: [1.3, 1.0, 1.1, 0.85] },
  mage: { title: 'Mage', weapon: 'staff', gear: ['wizard', 'hood'], body: 'robe', bias: [0.8, 1.25, 0.7, 1.0] },
  rogue: { title: 'Rogue', weapon: 'daggers', gear: ['hood', 'mask', 'none'], body: 'leather', bias: [0.85, 1.05, 0.75, 1.4] },
  paladin: { title: 'Paladin', weapon: 'hammer', gear: ['helmet', 'crown'], body: 'armor', shield: true, cape: true, bias: [1.25, 0.9, 1.35, 0.75] },
  ranger: { title: 'Ranger', weapon: 'bow', gear: ['feather', 'hood'], body: 'leather', bias: [1.0, 1.1, 0.85, 1.15] },
  knight: { title: 'Knight', weapon: 'spear', gear: ['plume'], body: 'armor', cape: true, bias: [1.2, 1.05, 1.2, 0.8] },
  barbarian: { title: 'Barbarian', weapon: 'axe', gear: ['headband', 'none'], body: 'bare', bias: [1.4, 1.2, 0.7, 0.9] },
  monk: { title: 'Monk', weapon: 'fists', gear: ['none', 'headband'], body: 'gi', bias: [1.0, 1.0, 0.9, 1.3] },
  necromancer: { title: 'Necromancer', weapon: 'scythe', gear: ['hood'], body: 'robe', bias: [0.85, 1.2, 0.8, 0.95] },
};

const SKIN = ['#f6d1b0', '#e8b48f', '#c98c62', '#9a6440', '#6e4428', '#f3c9a6', '#b5d3a0', '#a7b7e8'];
const HAIR = ['#2a1d17', '#5a3a22', '#a0662f', '#e0b04a', '#d9d2c5', '#b0342c', '#3b3f8f', '#2f7a68', '#e07bb4', '#f1f1f1'];
// [primary, secondary] outfit pairs
const OUTFITS = [
  ['#c0392b', '#f1c40f'], ['#2e86de', '#dfe6e9'], ['#6c5ce7', '#fdcb6e'], ['#27ae60', '#e1b12c'],
  ['#2d3436', '#e17055'], ['#e84393', '#ffeaa7'], ['#00a8a8', '#2d3436'], ['#8e5a2b', '#d4a373'],
  ['#5f27cd', '#48dbfb'], ['#c7ecee', '#535c68'], ['#ff9f43', '#222f3e'], ['#1e3799', '#e58e26'],
  ['#3d3d3d', '#9b59b6'], ['#16a085', '#f6e58d'], ['#b33939', '#2c2c54'],
];
const ACCENT = ['#ffd166', '#7bed9f', '#70a1ff', '#ff6b81', '#eccc68', '#a29bfe', '#ff9ff3', '#48dbfb'];
const HAIRSTYLES = ['short', 'long', 'spiky', 'bald', 'ponytail'];

const SYL_A = ['Ka', 'Ly', 'Mor', 'Ae', 'Thra', 'Vel', 'Zan', 'Ori', 'Bryn', 'Sel', 'Dra', 'Fen', 'Isa', 'Rho', 'Cal', 'Nyx', 'Tor', 'Mi', 'Quin', 'Ash', 'Eli', 'Gor', 'Ju', 'Wren'];
const SYL_B = ['', '', 'ri', 'an', 'or', 've', 'li', 'tha', 'ka', 'mo', 'su', 'ze'];
const SYL_C = ['n', 'th', 'ra', 'x', 's', 'dor', 'wyn', 'ia', 'el', 'us', 'mir', 'ka', 'on', 'ys', 'ric'];

// String seed → deterministic random() in [0, 1).
function seededRandom(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ----- Summoned characters -----
// Say "summon <name>" in the project chat to swap the project's hero:
//   - Famous characters below have hand-built looks and stats.
//   - Any other name becomes a hero generated deterministically from that name
//     (same name, same hero), shown under the name that was asked for.
// Seeds look like "summon:<name>", so they can never come from the random pool.

export const VADER_SEED = 'secret:darth-vader'; // kept as-is so saved Vader heroes still load

const palette = (c) => ({ hair: '#2a1d17', pants: '#3b3b58', boots: '#2b1d14', metal: '#cfd8e3', ...c });

export const CHARACTERS = [
  {
    names: ['darth vader', 'vader'],
    seed: VADER_SEED,
    quote: 'I find your lack of faith disturbing.',
    hero: {
      name: 'Darth Vader', classId: 'sith', cls: 'Sith Lord',
      weapon: 'sword', body: 'armor', shield: false, cape: true, gear: 'vader', hair: 'bald',
      signatureGlow: '#ff2a2a', // the blade always glows red
      colors: palette({
        skin: '#1c1c24', hair: '#101014', primary: '#15151b', secondary: '#7b8190', accent: '#c9ced8',
        pants: '#0e0e12', boots: '#08080a', metal: '#ff3b30',
      }),
      stats: { hp: 150, atk: 150, def: 135, spd: 95 },
    },
  },
  {
    names: ['yoda'],
    quote: 'Do or do not. There is no try.',
    hero: {
      name: 'Yoda', classId: 'jedi', cls: 'Jedi Master',
      weapon: 'staff', body: 'robe', shield: false, cape: false, gear: 'none', hair: 'bald',
      colors: palette({ skin: '#8fbf6a', primary: '#d9c9a3', secondary: '#8a6a43', accent: '#9be564', boots: '#5a4630' }),
      stats: { hp: 110, atk: 150, def: 100, spd: 140 },
    },
  },
  {
    names: ['gandalf'],
    quote: 'You shall not pass!',
    hero: {
      name: 'Gandalf', classId: 'wizard', cls: 'Wizard',
      weapon: 'staff', body: 'robe', shield: false, cape: false, gear: 'wizard', hair: 'long',
      colors: palette({ skin: '#f0cfae', hair: '#e8e8ee', primary: '#8c8c96', secondary: '#c9c9d2', accent: '#7dd3fc', boots: '#3a3a44' }),
      stats: { hp: 120, atk: 160, def: 90, spd: 90 },
    },
  },
  {
    names: ['goku', 'son goku'],
    quote: 'I am the hope of the universe!',
    hero: {
      name: 'Goku', classId: 'saiyan', cls: 'Saiyan',
      weapon: 'fists', body: 'gi', shield: false, cape: false, gear: 'none', hair: 'spiky',
      colors: palette({
        skin: '#f3c9a6', hair: '#14141a', primary: '#f57c00', secondary: '#1e40af', accent: '#1e40af',
        pants: '#f57c00', boots: '#1e3a8a',
      }),
      stats: { hp: 145, atk: 165, def: 100, spd: 140 },
    },
  },
  {
    names: ['batman', 'the batman'],
    quote: 'I am vengeance. I am the night.',
    hero: {
      name: 'Batman', classId: 'vigilante', cls: 'Dark Knight',
      weapon: 'daggers', body: 'leather', shield: false, cape: true, gear: 'hood', hair: 'short',
      colors: palette({
        skin: '#e8b48f', hair: '#14141a', primary: '#2b2f3a', secondary: '#3a4050', accent: '#f5c542',
        pants: '#2b2f3a', boots: '#101015', metal: '#aab2c0',
      }),
      stats: { hp: 130, atk: 130, def: 125, spd: 120 },
    },
  },
  {
    names: ['link'],
    quote: 'Hyah!',
    hero: {
      name: 'Link', classId: 'hylian', cls: 'Hero of Time',
      weapon: 'sword', body: 'leather', shield: true, cape: false, gear: 'feather', hair: 'short',
      colors: palette({
        skin: '#f3c9a6', hair: '#e0b04a', primary: '#3a9d3a', secondary: '#8a5a2b', accent: '#f5c542',
        pants: '#d9c9a3', boots: '#6b4423',
      }),
      stats: { hp: 125, atk: 125, def: 120, spd: 115 },
    },
  },
  {
    names: ['naruto', 'naruto uzumaki'],
    quote: 'Believe it!',
    hero: {
      name: 'Naruto', classId: 'ninja', cls: 'Ninja',
      weapon: 'daggers', body: 'gi', shield: false, cape: false, gear: 'headband', hair: 'spiky',
      colors: palette({
        skin: '#f3c9a6', hair: '#f5d142', primary: '#ff7a00', secondary: '#1e3a8a', accent: '#3b5ba5',
        pants: '#ff7a00', boots: '#1e3a8a',
      }),
      stats: { hp: 140, atk: 150, def: 100, spd: 130 },
    },
  },
  {
    names: ['luffy', 'monkey d luffy'],
    quote: "I'm gonna be King of the Pirates!",
    hero: {
      name: 'Luffy', classId: 'pirate', cls: 'Rubber Captain',
      weapon: 'fists', body: 'bare', shield: false, cape: false, gear: 'strawhat', hair: 'short',
      colors: palette({
        skin: '#f3c9a6', hair: '#14141a', primary: '#2a5db0', secondary: '#f1c40f', accent: '#f3c9a6', boots: '#7a4a24',
      }),
      stats: { hp: 150, atk: 150, def: 90, spd: 120 },
    },
  },
  {
    names: ['zoro', 'roronoa zoro'],
    quote: 'Nothing happened.',
    hero: {
      name: 'Zoro', classId: 'swordsman', cls: 'Three-Sword Style',
      weapon: 'sword', body: 'gi', shield: false, cape: false, gear: 'headband', hair: 'spiky',
      colors: palette({
        skin: '#e8b48f', hair: '#3f9d4a', primary: '#e8e8e0', secondary: '#3f9d4a', accent: '#1b1b1b',
        pants: '#1f1f1f', boots: '#1b1b1b',
      }),
      stats: { hp: 135, atk: 155, def: 110, spd: 115 },
    },
  },
  {
    names: ['mario', 'super mario'],
    quote: "It's-a me, Mario!",
    hero: {
      name: 'Mario', classId: 'plumber', cls: 'Plumber',
      weapon: 'fists', body: 'leather', shield: false, cape: false, gear: 'cap', hair: 'short', stache: true,
      colors: palette({
        skin: '#f3c9a6', hair: '#5a3a22', primary: '#d63031', secondary: '#2b4fb3', accent: '#ffffff',
        pants: '#2b4fb3', boots: '#5a3a22',
      }),
      stats: { hp: 120, atk: 110, def: 110, spd: 110 },
    },
  },
  {
    names: ['sonic', 'sonic the hedgehog'],
    quote: 'Gotta go fast!',
    hero: {
      name: 'Sonic', classId: 'hedgehog', cls: 'Blue Blur',
      weapon: 'fists', body: 'bare', shield: false, cape: false, gear: 'none', hair: 'spiky',
      colors: palette({
        skin: '#2b6cff', hair: '#1f4fd8', primary: '#2b6cff', secondary: '#f5d6b0', accent: '#ffffff', boots: '#d63031',
      }),
      stats: { hp: 100, atk: 120, def: 80, spd: 175 },
    },
  },
  {
    names: ['spider-man', 'spiderman', 'spider man'],
    quote: 'With great power comes great responsibility.',
    hero: {
      name: 'Spider-Man', classId: 'webslinger', cls: 'Web-Slinger',
      weapon: 'fists', body: 'leather', shield: false, cape: false, gear: 'fullmask', hair: 'bald',
      colors: palette({
        skin: '#d63031', primary: '#d63031', secondary: '#1f3fa8', accent: '#d63031', pants: '#1f3fa8', boots: '#d63031',
      }),
      stats: { hp: 120, atk: 125, def: 100, spd: 150 },
    },
  },
  {
    names: ['superman', 'clark kent'],
    quote: 'Up, up and away!',
    hero: {
      name: 'Superman', classId: 'kryptonian', cls: 'Man of Steel',
      weapon: 'fists', body: 'leather', shield: false, cape: true, gear: 'none', hair: 'short',
      colors: palette({
        skin: '#f3c9a6', hair: '#14141a', primary: '#2f6fdc', secondary: '#d63031', accent: '#f3c9a6',
        pants: '#2f6fdc', boots: '#d63031',
      }),
      stats: { hp: 165, atk: 165, def: 150, spd: 140 },
    },
  },
  {
    names: ['iron man', 'ironman', 'tony stark'],
    quote: 'I am Iron Man.',
    hero: {
      name: 'Iron Man', classId: 'armored', cls: 'Armored Avenger',
      weapon: 'fists', body: 'armor', shield: false, cape: false, gear: 'helmet', hair: 'short',
      colors: palette({
        skin: '#f3c9a6', primary: '#c0392b', secondary: '#f1c40f', accent: '#f1c40f',
        pants: '#c0392b', boots: '#d4a017', metal: '#c0392b',
      }),
      stats: { hp: 130, atk: 150, def: 130, spd: 110 },
    },
  },
  {
    names: ['pikachu'],
    quote: 'Pika pika!',
    hero: {
      name: 'Pikachu', classId: 'electric', cls: 'Electric Mouse',
      weapon: 'fists', body: 'bare', shield: false, cape: false, gear: 'ears', hair: 'bald',
      colors: palette({ skin: '#f7d02c', primary: '#f7d02c', secondary: '#c58b2a', accent: '#f7d02c', boots: '#f7d02c' }),
      stats: { hp: 95, atk: 130, def: 80, spd: 160 },
    },
  },
  {
    names: ['mega man', 'megaman', 'rockman'],
    quote: "Let's go, Mega Buster!",
    hero: {
      name: 'Mega Man', classId: 'robot', cls: 'Blue Bomber',
      weapon: 'fists', body: 'armor', shield: false, cape: false, gear: 'helmet', hair: 'bald',
      colors: palette({
        skin: '#f3c9a6', primary: '#2f6fdc', secondary: '#7ec8ff', accent: '#7ec8ff',
        pants: '#2f6fdc', boots: '#2f6fdc', metal: '#2f6fdc',
      }),
      stats: { hp: 120, atk: 135, def: 110, spd: 125 },
    },
  },
  {
    names: ['samus', 'samus aran'],
    quote: 'The last Metroid is in captivity.',
    hero: {
      name: 'Samus Aran', classId: 'bounty', cls: 'Bounty Hunter',
      weapon: 'fists', body: 'armor', shield: false, cape: false, gear: 'helmet', hair: 'bald',
      colors: palette({
        skin: '#f3c9a6', primary: '#e8892b', secondary: '#2ecc71', accent: '#e8892b',
        pants: '#e8892b', boots: '#c0661a', metal: '#e8892b',
      }),
      stats: { hp: 135, atk: 140, def: 135, spd: 110 },
    },
  },
  {
    names: ['harry potter', 'harry'],
    quote: 'Expecto Patronum!',
    hero: {
      name: 'Harry Potter', classId: 'wizard-student', cls: 'Boy Who Lived',
      weapon: 'staff', body: 'robe', shield: false, cape: false, gear: 'none', hair: 'short', glasses: true,
      colors: palette({
        skin: '#f0cfae', hair: '#14141a', primary: '#1b1b2a', secondary: '#a31621', accent: '#f5c542',
        pants: '#2b2b3a', boots: '#1b1b1b',
      }),
      stats: { hp: 105, atk: 145, def: 90, spd: 115 },
    },
  },
  {
    names: ['kratos', 'ghost of sparta'],
    quote: 'Boy.',
    hero: {
      name: 'Kratos', classId: 'spartan', cls: 'Ghost of Sparta',
      weapon: 'axe', body: 'bare', shield: false, cape: false, gear: 'none', hair: 'bald',
      colors: palette({
        skin: '#d9d2c5', primary: '#5a3a22', secondary: '#b0342c', accent: '#b0342c', boots: '#3a2a1e', metal: '#9aa4b2',
      }),
      stats: { hp: 160, atk: 165, def: 125, spd: 90 },
    },
  },
  {
    names: ['cloud strife', 'cloud'],
    quote: 'Not interested.',
    hero: {
      name: 'Cloud Strife', classId: 'soldier', cls: 'Ex-SOLDIER',
      weapon: 'sword', body: 'armor', shield: false, cape: false, gear: 'none', hair: 'spiky',
      colors: palette({
        skin: '#f3c9a6', hair: '#f1d65a', primary: '#2a3a6e', secondary: '#7a7f8c', accent: '#a29bfe',
        pants: '#2a3a6e', boots: '#3a2a1e',
      }),
      stats: { hp: 140, atk: 160, def: 110, spd: 110 },
    },
  },
];

// The parts the sprite rig can draw. src/main/hero-design.js keeps its own copy for validating
// designs from Claude: keep both in sync (tools/check-roster.mjs compares them).
// `vader` is left out of the designable gear on purpose: it is reserved for Darth Vader.
export const RIG = {
  weapon: ['sword', 'daggers', 'staff', 'hammer', 'axe', 'spear', 'scythe', 'bow', 'fists'],
  body: ['armor', 'leather', 'robe', 'bare', 'gi'],
  gear: ['none', 'helmet', 'plume', 'wizard', 'hood', 'mask', 'headband', 'crown', 'feather', 'strawhat', 'cap', 'fullmask', 'ears'],
  hair: ['short', 'long', 'spiky', 'bald', 'ponytail'],
  colors: ['skin', 'hair', 'primary', 'secondary', 'accent', 'pants', 'boots', 'metal'],
};

const SUMMON_MAX_WORDS = 5; // "summon" + up to 4 words, for names that are not famous characters
const MAX_NAME_LENGTH = 40;

const titleCase = (text) => text.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9\s'.-]/g, ' ').replace(/\s+/g, ' ').trim();

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Longest alias first, so "summon cloud strife" is not taken for "summon cloud".
const ALIASES = CHARACTERS.flatMap((character) => character.names.map((alias) => ({ alias, character })))
  .sort((a, b) => b.alias.length - a.alias.length);

function summonSeed(character, name) {
  return character?.seed || `summon:${name}`;
}

/**
 * The character asked for in `text`, or null.
 * Famous characters match anywhere ("please summon Batman!"). Any other name needs a
 * short message that starts with "summon" ("summon Captain Jack Sparrow").
 * @returns {{seed: string, name: string, quote?: string, famous: boolean} | null}
 */
export function findSummon(text) {
  const words = normalize(text);
  for (const { alias, character } of ALIASES) {
    if (new RegExp(`\\bsummon (?:the )?${escapeRegExp(alias)}\\b`).test(words)) {
      return { seed: summonSeed(character, character.names[0]), name: character.hero.name, quote: character.quote, famous: true };
    }
  }
  if (!words.startsWith('summon ') || words.split(' ').length > SUMMON_MAX_WORDS) return null;
  const name = words.slice('summon '.length).replace(/^the /, '').replace(/ please$/, '').trim();
  if (!name || name.length > MAX_NAME_LENGTH || !/[a-z0-9]/.test(name)) return null;
  return { seed: summonSeed(null, name), name: titleCase(name), famous: false };
}

/** Hand-built hero for a seed, if it belongs to a famous character. */
function characterFor(seed) {
  return CHARACTERS.find((c) => summonSeed(c, c.names[0]) === seed) || null;
}

const HEX = /^#[0-9a-f]{6}$/i;
const inList = (list, v) => typeof v === 'string' && list.includes(v);

/**
 * Hero built from a design that the main process validated (see src/main/hero-design.js).
 * The checks are repeated here so a bad object can never reach the sprite; null if anything is off.
 */
function heroFromDesign(seed, d) {
  if (!d || typeof d !== 'object') return null;
  if (!inList(RIG.weapon, d.weapon) || !inList(RIG.body, d.body) || !inList(RIG.gear, d.gear) || !inList(RIG.hair, d.hair)) return null;
  if (!d.colors || !RIG.colors.every((k) => HEX.test(d.colors[k]))) return null;
  const st = d.stats || {};
  if (!['hp', 'atk', 'def', 'spd'].every((k) => Number.isFinite(st[k]))) return null;
  const colors = Object.fromEntries(RIG.colors.map((k) => [k, d.colors[k]]));
  if (d.signatureGlow !== undefined && !HEX.test(d.signatureGlow)) return null;
  return {
    seed, secret: true, name: titleCase(seed.slice('summon:'.length)), classId: 'summoned',
    cls: typeof d.cls === 'string' ? d.cls.slice(0, 24) : 'Summoned',
    weapon: d.weapon, body: d.body, gear: d.gear, hair: d.hair,
    shield: d.shield === true, cape: d.cape === true, stache: d.stache === true, glasses: d.glasses === true,
    ...(d.signatureGlow ? { signatureGlow: d.signatureGlow } : {}),
    colors,
    stats: { hp: st.hp, atk: st.atk, def: st.def, spd: st.spd },
  };
}

export function generateHero(seed, design) {
  const character = characterFor(seed);
  if (character) return { seed, secret: true, ...character.hero };
  if (design && seed.startsWith('summon:')) {
    const designed = heroFromDesign(seed, design);
    if (designed) return designed;
  }
  const hero = generateRandomHero(seed);
  // Any other summoned name keeps its generated looks but wears the name it was summoned by.
  if (seed.startsWith('summon:')) return { ...hero, secret: true, name: titleCase(seed.slice('summon:'.length)) };
  return hero;
}

function generateRandomHero(seed) {
  const rand = seededRandom(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];

  const classId = pick(Object.keys(CLASSES));
  const cls = CLASSES[classId];
  const [primary, secondary] = pick(OUTFITS);
  const raw = SYL_A[Math.floor(rand() * SYL_A.length)] + pick(SYL_B) + pick(SYL_C);
  const name = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  const stat = (base, bias) => Math.round(base * bias * (0.9 + rand() * 0.2));

  return {
    seed,
    name,
    classId,
    cls: cls.title,
    weapon: cls.weapon,
    body: cls.body,
    shield: !!cls.shield,
    cape: !!cls.cape,
    gear: pick(cls.gear),
    hair: cls.gear.includes('wizard') && rand() < 0.3 ? 'long' : pick(HAIRSTYLES),
    colors: {
      skin: pick(SKIN),
      hair: pick(HAIR),
      primary,
      secondary,
      accent: pick(ACCENT),
      pants: pick(['#3b3b58', '#4a3728', '#2d4059', '#3d3d3d', '#5b4a3a']),
      boots: pick(['#2b1d14', '#3a2a1e', '#1f1f2b', '#4b3621']),
      metal: '#cfd8e3',
    },
    stats: {
      hp: stat(100, cls.bias[0]),
      atk: stat(100, cls.bias[1]),
      def: stat(100, cls.bias[2]),
      spd: stat(100, cls.bias[3]),
    },
  };
}


