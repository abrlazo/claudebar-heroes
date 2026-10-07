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

const CHARACTERS = [
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
];

const SUMMON_MAX_WORDS = 5; // "summon" + up to 4 words, for names that are not famous characters
const MAX_NAME_LENGTH = 40;

const titleCase = (text) => text.replace(/\b[a-z]/g, (c) => c.toUpperCase());
const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9\s'.-]/g, ' ').replace(/\s+/g, ' ').trim();

function summonSeed(character, name) {
  return character?.seed || `summon:${name}`;
}

/**
 * The character asked for in `text`, or null.
 * Famous characters match anywhere ("please summon Batman!"). Any other name needs a
 * short message that starts with "summon" ("summon Captain Jack Sparrow").
 * @returns {{seed: string, name: string, quote?: string} | null}
 */
export function findSummon(text) {
  const words = normalize(text);
  for (const character of CHARACTERS) {
    for (const alias of character.names) {
      if (new RegExp(`\\bsummon (?:the )?${alias}\\b`).test(words)) {
        return { seed: summonSeed(character, character.names[0]), name: character.hero.name, quote: character.quote };
      }
    }
  }
  if (!words.startsWith('summon ') || words.split(' ').length > SUMMON_MAX_WORDS) return null;
  const name = words.slice('summon '.length).replace(/^the /, '').replace(/ please$/, '').trim();
  if (!name || name.length > MAX_NAME_LENGTH || !/[a-z0-9]/.test(name)) return null;
  return { seed: summonSeed(null, name), name: titleCase(name) };
}

/** Hand-built hero for a seed, if it belongs to a famous character. */
function characterFor(seed) {
  return CHARACTERS.find((c) => summonSeed(c, c.names[0]) === seed) || null;
}

export function generateHero(seed) {
  const character = characterFor(seed);
  if (character) return { seed, secret: true, ...character.hero };
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


