// Level prestige: a glowing weapon from level 10 and a power-up aura from level 15.
// Pure functions, no DOM, so the rules are easy to read and test.
//
//   Weapon glow: level 10 = colour 1, 15 = colour 2, 20 = colour 3, ... (every 5 levels)
//   Aura:        level 15 = colour 1, 30 = colour 2, 45 = colour 3, ... (every 15 levels)
//   Lightning:   the aura gains lightning from level 25 onwards
//
// Palettes repeat once they run out.

export const WEAPON_GLOW_START = 10;
export const WEAPON_GLOW_STEP = 5;
export const AURA_START = 15;
export const AURA_STEP = 15;
export const LIGHTNING_START = 25; // the aura only crackles with lightning from this level

export const WEAPON_GLOW_COLORS = [
  '#7dd3fc', // 1 ice blue
  '#4ade80', // 2 green
  '#facc15', // 3 gold
  '#fb923c', // 4 orange
  '#f472b6', // 5 pink
  '#a78bfa', // 6 violet
  '#f87171', // 7 red
  '#ffffff', // 8 white
];

export const AURA_COLORS = [
  '#ffd23f', // 1 super saiyan gold
  '#38bdf8', // 2 blue
  '#ec4899', // 3 rose
  '#a855f7', // 4 purple
  '#22c55e', // 5 green
  '#ffffff', // 6 white
];

/** 0 = no glow yet; otherwise 1 for levels 10-14, 2 for 15-19, 3 for 20-24, ... */
export function weaponGlowTier(level) {
  return level >= WEAPON_GLOW_START ? Math.floor((level - WEAPON_GLOW_START) / WEAPON_GLOW_STEP) + 1 : 0;
}

/** 0 = no aura yet; otherwise 1 for levels 15-29, 2 for 30-44, 3 for 45-59, ... */
export function auraTier(level) {
  return level >= AURA_START ? Math.floor(level / AURA_STEP) : 0;
}

/** Everything the hero needs to look the part at `level`. */
export function prestigeFor(level) {
  const weaponTier = weaponGlowTier(level);
  const aura = auraTier(level);
  return {
    weaponTier,
    auraTier: aura,
    weaponColor: weaponTier ? WEAPON_GLOW_COLORS[(weaponTier - 1) % WEAPON_GLOW_COLORS.length] : null,
    auraColor: aura ? AURA_COLORS[(aura - 1) % AURA_COLORS.length] : null,
    /** True from level 25: lightning crackles around the aura. */
    lightning: aura > 0 && level >= LIGHTNING_START,
    /** Level at which the weapon glow changes colour next (or first appears). */
    nextWeaponLevel: weaponTier ? WEAPON_GLOW_START + weaponTier * WEAPON_GLOW_STEP : WEAPON_GLOW_START,
    /** Level at which the aura changes colour next (or first appears). */
    nextAuraLevel: aura ? (aura + 1) * AURA_STEP : AURA_START,
  };
}
