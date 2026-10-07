// Turns an untrusted object (Claude's answer to "design this hero") into a safe hero spec.
// Everything the renderer is ever allowed to draw from a design passes through validateDesign:
// only known keys are read, every value is checked against an allowlist or a strict pattern.
// The hero's name never comes from the design, only from the (already validated) summon seed.

// Keep in sync with RIG in src/renderer/engine/heroes.js (tools/check-roster.mjs compares them).
// `vader` is not designable: it is reserved for the hand-built Darth Vader.
const RIG = {
  weapon: ['sword', 'daggers', 'staff', 'hammer', 'axe', 'spear', 'scythe', 'bow', 'fists'],
  body: ['armor', 'leather', 'robe', 'bare', 'gi'],
  gear: ['none', 'helmet', 'plume', 'wizard', 'hood', 'mask', 'headband', 'crown', 'feather', 'strawhat', 'cap', 'fullmask', 'ears'],
  hair: ['short', 'long', 'spiky', 'bald', 'ponytail'],
  colors: ['skin', 'hair', 'primary', 'secondary', 'accent', 'pants', 'boots', 'metal'],
};

const MAX_JSON_LENGTH = 1500;
const MAX_DESIGNS = 50;
const STAT_MIN = 80;
const STAT_MAX = 175;
const STAT_TOTAL_MAX = 560;
const HEX = /^#[0-9a-f]{6}$/i;
const OUTLINE = [0x14, 0x12, 0x1f]; // the sprite outline colour: darker parts would vanish into it

const isPlainObject = (v) => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
const pick = (list, v) => (typeof v === 'string' && list.includes(v) ? v : null);

// Colours that nearly match the sprite outline are lightened 15% so the character stays readable.
function readable(hex) {
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const dist = Math.hypot(...rgb.map((v, i) => v - OUTLINE[i]));
  if (dist >= 30) return hex.toLowerCase();
  return `#${rgb.map((v) => Math.round(v + (255 - v) * 0.15).toString(16).padStart(2, '0')).join('')}`;
}

function readStats(raw) {
  if (!isPlainObject(raw)) return null;
  const keys = ['hp', 'atk', 'def', 'spd'];
  const stats = {};
  for (const k of keys) {
    if (typeof raw[k] !== 'number' || !Number.isFinite(raw[k])) return null;
    stats[k] = Math.max(STAT_MIN, Math.min(STAT_MAX, Math.round(raw[k])));
  }
  const total = keys.reduce((sum, k) => sum + stats[k], 0);
  if (total > STAT_TOTAL_MAX) {
    // Scale what is above the minimum, so the total fits and no stat drops below it.
    const k = (STAT_TOTAL_MAX - STAT_MIN * 4) / (total - STAT_MIN * 4);
    for (const key of keys) stats[key] = Math.floor(STAT_MIN + (stats[key] - STAT_MIN) * k);
  }
  return stats;
}

/**
 * @param {unknown} raw  parsed JSON from Claude
 * @returns {{ok: true, design: object} | {ok: false, reason: string}}
 */
function validateDesign(raw) {
  let size;
  try { size = JSON.stringify(raw)?.length ?? 0; } catch { return { ok: false, reason: 'invalid answer' }; }
  if (size > MAX_JSON_LENGTH) return { ok: false, reason: 'invalid answer' };
  if (!isPlainObject(raw)) return { ok: false, reason: 'invalid answer' };

  const cls = typeof raw.cls === 'string' ? raw.cls.trim().slice(0, 24) : '';
  const weapon = pick(RIG.weapon, raw.weapon);
  const body = pick(RIG.body, raw.body);
  const gear = pick(RIG.gear, raw.gear);
  const hair = pick(RIG.hair, raw.hair);
  if (!cls || !/^[A-Za-z0-9 '.-]+$/.test(cls) || !weapon || !body || !gear || !hair) return { ok: false, reason: 'invalid answer' };

  if (!isPlainObject(raw.colors)) return { ok: false, reason: 'invalid answer' };
  const colors = {};
  for (const key of RIG.colors) {
    const v = raw.colors[key];
    if (typeof v !== 'string' || !HEX.test(v)) return { ok: false, reason: 'invalid answer' };
    colors[key] = readable(v);
  }
  const stats = readStats(raw.stats);
  if (!stats) return { ok: false, reason: 'invalid answer' };

  const design = {
    cls, weapon, body, gear, hair,
    shield: raw.shield === true, cape: raw.cape === true, stache: raw.stache === true, glasses: raw.glasses === true,
    colors, stats,
  };
  if (weapon !== 'fists' && typeof raw.signatureGlow === 'string' && HEX.test(raw.signatureGlow)) {
    design.signatureGlow = raw.signatureGlow.toLowerCase();
  }
  return { ok: true, design };
}

/** The saved design for a summoned name (own keys only: "constructor" is a valid name). */
function designFor(designs, name) {
  return designs && Object.prototype.hasOwnProperty.call(designs, name) ? designs[name] : null;
}

/** A new designs map with `design` stored for `name` (stamped with `at`); the oldest are evicted past MAX_DESIGNS. */
function rememberDesign(designs, name, design) {
  const next = { ...(designs || {}), [name]: { ...design, at: Date.now() } };
  const names = Object.keys(next);
  if (names.length > MAX_DESIGNS) {
    names.sort((a, b) => (next[a].at || 0) - (next[b].at || 0));
    for (const old of names.slice(0, names.length - MAX_DESIGNS)) delete next[old];
  }
  return next;
}

/** The question sent to Claude. `name` has already passed the summon-name pattern; it goes in as a JSON string. */
function designPrompt(name) {
  const list = (items) => `[${items.map((i) => `"${i}"`).join(',')}]`;
  return `You design pixel-art RPG heroes for a tiny sprite rig (a 32x30 pixel character, 7x6 pixel head).
Design the hero for the character named ${JSON.stringify(name)}. Match the character's most iconic hair colour, skin colour,
outfit colours and signature item as closely as the allowed parts permit. If you do not know this character,
still return a plausible fantasy hero in the colours the name suggests.
Reply with ONE JSON object and nothing else (no prose, no code fences), exactly these keys:
{
  "cls": short title, max 24 chars, letters/digits/space only (e.g. "Ninja"),
  "weapon": one of ${list(RIG.weapon)},
  "body": one of ${list(RIG.body)},
  "gear": one of ${list(RIG.gear)},
  "hair": one of ${list(RIG.hair)},
  "shield": true or false,
  "cape": true or false,
  "stache": true or false,
  "glasses": true or false,
  "colors": { ${RIG.colors.map((k) => `"${k}": "#rrggbb"`).join(', ')} },
  "stats": { "hp": 80-175, "atk": 80-175, "def": 80-175, "spd": 80-175 }
}
Notes: "primary" is the shirt/robe/armour colour, "secondary" the trim, belt and cape colour, "accent" the hat band,
headband and glove (when weapon is fists) colour, "metal" the blade and helmet colour. With body "bare", "primary" is
the colour of the trousers. "fullmask" covers the whole head in "primary". Hex colours only, lower-case, 6 digits.
`;
}

/** The JSON object inside Claude's answer (it may add code fences), or null. */
function parseDesignText(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}

module.exports = { RIG, MAX_DESIGNS, validateDesign, designFor, rememberDesign, designPrompt, parseDesignText };
