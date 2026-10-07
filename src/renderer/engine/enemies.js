// Enemy catalogue and the animated monster sprites.
//
// Four monster kinds share one animated rig: goblin, skeleton, orc and imp.
// Maps differ in which monsters roam and in their colours, chosen to contrast
// with each map's background. Monsters face left (toward the hero) and animate
// their head, feet and weapon hand:
//   walk  - feet step, body and head bob, free arm swings
//   fight - feet planted, weapon arm winds up and slams, head thrusts forward
//   idle  - slight sway (waiting in line behind the monster that is fighting)

/**
 * @typedef {{kind: 'goblin'|'skeleton'|'orc'|'imp', name: string, skin: string,
 *            cloth: string, weapon: 'club'|'dagger'|'axe'|'sword', hp: number,
 *            id?: string, boss?: boolean}} MonsterLook
 */

/** @type {Record<string, MonsterLook[]>} */
export const ENEMY_TYPES = {
  forest: [
    { kind: 'goblin', name: 'Forest Goblin', skin: '#ff7a2f', cloth: '#3b2a1a', weapon: 'club', hp: 1 },
    { kind: 'skeleton', name: 'Skeleton Warrior', skin: '#ece7d3', cloth: '#3b2a1a', weapon: 'sword', hp: 1 },
    { kind: 'orc', name: 'Orc Brute', skin: '#c24bd6', cloth: '#2b1b12', weapon: 'axe', hp: 1.5 },
  ],
  desert: [
    { kind: 'goblin', name: 'Sand Goblin', skin: '#9d6bff', cloth: '#2d1b4e', weapon: 'dagger', hp: 1.2 },
    { kind: 'skeleton', name: 'Bone Raider', skin: '#6d7dff', cloth: '#1f1238', weapon: 'sword', hp: 1.1 },
    { kind: 'orc', name: 'Orc Marauder', skin: '#2f9e63', cloth: '#3a2414', weapon: 'club', hp: 1.5 },
    { kind: 'imp', name: 'Dust Imp', skin: '#8e3df5', cloth: '#1f1238', weapon: 'dagger', hp: 0.8 },
  ],
  snowy: [
    { kind: 'goblin', name: 'Frost Goblin', skin: '#ff5a36', cloth: '#3a1e1e', weapon: 'club', hp: 1.1 },
    { kind: 'skeleton', name: 'Frozen Skeleton', skin: '#33425e', cloth: '#1c2a44', weapon: 'sword', hp: 1 },
    { kind: 'orc', name: 'Ice Orc', skin: '#d9432f', cloth: '#1f2a3a', weapon: 'axe', hp: 1.5 },
  ],
  lava: [
    { kind: 'goblin', name: 'Magma Goblin', skin: '#38d6ff', cloth: '#0b3a5a', weapon: 'axe', hp: 1.3 },
    { kind: 'skeleton', name: 'Ash Skeleton', skin: '#7ee8ff', cloth: '#0a2a44', weapon: 'sword', hp: 1.2 },
    { kind: 'imp', name: 'Cinder Imp', skin: '#00bfff', cloth: '#0a2a44', weapon: 'dagger', hp: 0.9 },
  ],
  night: [
    { kind: 'goblin', name: 'Shadow Goblin', skin: '#d6ff3f', cloth: '#2a2a1a', weapon: 'dagger', hp: 1.2 },
    { kind: 'skeleton', name: 'Grave Skeleton', skin: '#f2f2e0', cloth: '#1a1a2e', weapon: 'sword', hp: 1.2 },
    { kind: 'imp', name: 'Night Imp', skin: '#ffd23f', cloth: '#1a1a2e', weapon: 'club', hp: 0.9 },
    { kind: 'orc', name: 'Night Orc', skin: '#ff8a3d', cloth: '#1a1a2e', weapon: 'axe', hp: 1.6 },
  ],
};

/**
 * One boss per map: the 8th (stage-clearing) fight. Same bodies as the normal
 * monsters, drawn bigger and crowned (see createMonster and `.enemy.boss`).
 * `hp` is a multiplier like in ENEMY_TYPES. Keep the ids in sync with
 * `isBossId` in main/main.js.
 * @type {Record<string, MonsterLook>}
 */
export const BOSSES = {
  forest: { id: 'boss:forest', boss: true, kind: 'orc', name: 'Grukk, Orc King', skin: '#e0457b', cloth: '#3a1020', weapon: 'axe', hp: 5 },
  desert: { id: 'boss:desert', boss: true, kind: 'skeleton', name: 'Khamun, Bone Pharaoh', skin: '#4fd1c5', cloth: '#1f1238', weapon: 'sword', hp: 5 },
  snowy: { id: 'boss:snowy', boss: true, kind: 'orc', name: 'Rimefang, Ice Tyrant', skin: '#c0261d', cloth: '#1c2a44', weapon: 'club', hp: 5 },
  lava: { id: 'boss:lava', boss: true, kind: 'imp', name: 'Pyrax, Cinder Lord', skin: '#2ec4ff', cloth: '#0a2a44', weapon: 'dagger', hp: 5 },
  night: { id: 'boss:night', boss: true, kind: 'goblin', name: 'Nyx, Goblin Queen', skin: '#e6ff3a', cloth: '#2a1a3a', weapon: 'axe', hp: 5 },
};

// The figure is drawn in a 32x32 box inside a larger canvas so the raised
// weapon and the ears / horns are not clipped.
export const MONSTER_W = 44;
export const MONSTER_H = 40;
const OFFSET_X = 12;
const OFFSET_Y = 8;
const SWING_MS = 900;       // one full attack cycle
const SWING_IMPACT = 0.6;   // fraction of the cycle where the weapon lands

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift) => Math.max(0, Math.min(255, ((n >> shift) & 255) + amount));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** Weapon arm angle (0 = hanging down, positive = swung toward the hero) over one attack cycle. */
function swingAngle(s) {
  if (s < 0.45) return lerp(1.0, 2.6, clamp01(s / 0.45));                  // wind up overhead
  if (s < SWING_IMPACT) return lerp(2.6, 0.3, clamp01((s - 0.45) / 0.15)); // slam
  return lerp(0.3, 1.0, clamp01((s - SWING_IMPACT) / 0.4));                // recover
}

function drawWeapon(ctx, weapon) {
  // Origin is the hand; +y runs along the arm.
  if (weapon === 'club') {
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(-2, 5, 4, 9);
    ctx.fillStyle = '#4a2f18';
    ctx.fillRect(-2, 11, 4, 3);
  } else if (weapon === 'dagger') {
    ctx.fillStyle = '#8a5a2b';
    ctx.fillRect(-1, 4, 2, 3);
    ctx.fillStyle = '#dfe6ee';
    ctx.fillRect(-1, 7, 2, 7);
  } else if (weapon === 'sword') {
    ctx.fillStyle = '#8a5a2b';
    ctx.fillRect(-1, 4, 2, 3);
    ctx.fillStyle = '#b08a3a';
    ctx.fillRect(-3, 6, 6, 1);
    ctx.fillStyle = '#c9d2dc';
    ctx.fillRect(-1, 7, 2, 9);
  } else {
    ctx.fillStyle = '#6b4423';
    ctx.fillRect(-1, 3, 2, 11);
    ctx.fillStyle = '#c9d2dc';
    ctx.fillRect(-4, 10, 5, 4);
  }
}

/**
 * Per-kind body parts. Each draws legs, the free (back) arm, torso and head
 * from the shared pose `p`, and returns where the weapon arm attaches.
 * `p`: { rect, arm, foot, walking, fighting, stride, bob, slam, lean, phase, look, skin, dark }
 */
const BODIES = {
  goblin(p) {
    const { rect, walking, fighting, stride, bob, slam, lean, phase, look, skin, dark } = p;
    const frontX = 10 + (walking ? stride * 3 : fighting ? -1 : 0);
    const backX = 16 - (walking ? stride * 3 : 0);
    const frontLift = walking ? Math.max(0, Math.cos(phase)) * 2 : 0;
    const backLift = walking ? Math.max(0, -Math.cos(phase)) * 2 : 0;
    rect(dark, backX + 1, 24, 3, 6 - backLift);
    p.foot(backX, backLift, 5);
    rect(skin, frontX + 1, 24, 3, 6 - frontLift);
    p.foot(frontX, frontLift, 5);

    p.arm(19, 17 - bob, walking ? -stride * 0.7 : fighting ? 0.4 : Math.sin(phase * 0.5) * 0.15, false, 3);

    const torsoY = 15 - bob;
    rect(look.cloth, 12 - lean, torsoY, 9, 9);
    rect('#1d1410', 12 - lean, torsoY + 6, 9, 1);
    rect(skin, 14 - lean, torsoY, 4, 2);

    const hx = 11 - lean - slam;
    const hy = 7 + (walking ? Math.sin(phase * 2) : fighting ? Math.sin(phase * 3) * 0.5 : 0) - bob;
    const ctx = p.ctx;
    const earFlap = walking ? Math.sin(phase * 2) * 1.2 : 0;
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.moveTo(hx + 1, hy + 3); ctx.lineTo(hx - 7, hy + 1 + earFlap); ctx.lineTo(hx + 1, hy + 7);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(hx + 9, hy + 3); ctx.lineTo(hx + 15, hy + 1 - earFlap); ctx.lineTo(hx + 9, hy + 7);
    ctx.closePath(); ctx.fill();
    rect(skin, hx, hy, 10, 8);
    rect(dark, hx + 1, hy + 7, 8, 1);
    rect(skin, hx - 2, hy + 4, 3, 2);
    rect('#1a0f0a', hx + 1, hy + 2, 4, 1);
    rect('#fff23a', hx + 2, hy + 3, 2, 2);
    rect('#b3001b', hx + 2, hy + 4, 1, 1);
    rect('#fff', hx + 3, hy + 6, 1, 1);
    rect('#fff', hx + 6, hy + 6, 1, 1);
    return { x: 12 - lean, y: 17 - bob, w: 3, head: { x: hx, y: hy, w: 10 } };
  },

  skeleton(p) {
    const { rect, walking, fighting, stride, bob, slam, lean, phase, skin, dark } = p;
    const frontX = 10 + (walking ? stride * 3 : fighting ? -1 : 0);
    const backX = 17 - (walking ? stride * 3 : 0);
    const frontLift = walking ? Math.max(0, Math.cos(phase)) * 2 : 0;
    const backLift = walking ? Math.max(0, -Math.cos(phase)) * 2 : 0;
    rect(dark, backX + 1, 24, 2, 6 - backLift);
    p.foot(backX, backLift, 4, skin);
    rect(skin, frontX + 1, 24, 2, 6 - frontLift);
    p.foot(frontX, frontLift, 4, skin);

    p.arm(19, 17 - bob, walking ? -stride * 0.7 : fighting ? 0.4 : Math.sin(phase * 0.5) * 0.15, false, 2);

    const torsoY = 15 - bob;
    rect(skin, 15 - lean, torsoY, 2, 9);                       // spine
    for (let i = 0; i < 3; i++) rect(skin, 12 - lean, torsoY + 1 + i * 2, 8, 1); // ribs
    rect(dark, 13 - lean, torsoY + 2, 6, 1);
    rect(dark, 13 - lean, torsoY + 4, 6, 1);
    rect(skin, 12 - lean, torsoY + 7, 8, 2);                   // pelvis
    rect(p.look.cloth, 12 - lean, torsoY + 9, 8, 1);           // tattered belt

    const hx = 11 - lean - slam;
    const hy = 7 + (walking ? Math.sin(phase * 2) : fighting ? Math.sin(phase * 3) * 0.5 : 0) - bob;
    const jaw = fighting ? (Math.sin(p.phase * 7) > 0 ? 2 : 0) : walking && Math.sin(phase * 2) > 0.6 ? 1 : 0;
    rect(skin, hx, hy, 10, 8);                                 // skull
    rect(skin, hx + 1, hy + 8, 8, 1);
    rect('#12101a', hx + 1, hy + 3, 3, 3);                     // eye sockets
    rect('#12101a', hx + 5, hy + 3, 3, 3);
    rect('#ff3b3b', hx + 2, hy + 4, 1, 1);                     // glowing pupils
    rect('#ff3b3b', hx + 6, hy + 4, 1, 1);
    rect('#12101a', hx + 4, hy + 6, 1, 2);                     // nose hole
    rect(skin, hx + 2, hy + 9 + jaw, 6, 2);                    // jaw
    rect('#12101a', hx + 3, hy + 9 + jaw, 1, 1);               // teeth gaps
    rect('#12101a', hx + 5, hy + 9 + jaw, 1, 1);
    if (jaw) rect('#12101a', hx + 2, hy + 9, 6, jaw);          // open mouth
    return { x: 12 - lean, y: 17 - bob, w: 2, head: { x: hx, y: hy, w: 10 } };
  },

  orc(p) {
    const { rect, walking, fighting, stride, bob, slam, lean, phase, look, skin, dark } = p;
    const frontX = 9 + (walking ? stride * 2.5 : fighting ? -1 : 0);
    const backX = 16 - (walking ? stride * 2.5 : 0);
    const frontLift = walking ? Math.max(0, Math.cos(phase)) * 2 : 0;
    const backLift = walking ? Math.max(0, -Math.cos(phase)) * 2 : 0;
    rect(dark, backX + 1, 23, 4, 7 - backLift);
    p.foot(backX, backLift, 6);
    rect(skin, frontX + 1, 23, 4, 7 - frontLift);
    p.foot(frontX, frontLift, 6);

    p.arm(21, 16 - bob, walking ? -stride * 0.6 : fighting ? 0.4 : Math.sin(phase * 0.5) * 0.12, false, 4);

    const torsoY = 14 - bob;
    rect(skin, 11 - lean, torsoY, 12, 10);                     // broad chest
    rect(look.cloth, 11 - lean, torsoY + 4, 12, 6);            // armour
    rect('#7a7f88', 11 - lean, torsoY + 4, 12, 1);
    rect('#7a7f88', 14 - lean, torsoY + 6, 2, 2);              // rivets
    rect('#7a7f88', 18 - lean, torsoY + 6, 2, 2);
    rect('#7a7f88', 9 - lean, torsoY - 1, 5, 4);               // shoulder pad

    const hx = 11 - lean - slam;
    const hy = 5 + (walking ? Math.sin(phase * 2) * 1.2 : fighting ? Math.sin(phase * 3) * 0.5 : 0) - bob;
    rect(dark, hx + 9, hy + 2, 3, 3);                          // small ear
    rect(skin, hx, hy, 11, 9);                                 // head
    rect(dark, hx, hy + 8, 11, 2);                             // heavy jaw
    rect('#1a0f0a', hx + 1, hy + 2, 5, 2);                     // thick brow
    rect('#ffe14a', hx + 2, hy + 4, 2, 2);                     // eye
    rect('#a30010', hx + 2, hy + 5, 1, 1);
    rect('#fff', hx + 1, hy + 6, 2, 3);                        // tusks
    rect('#fff', hx + 6, hy + 6, 2, 3);
    rect(look.cloth, hx - 1, hy - 1, 12, 2);                   // headband
    return { x: 11 - lean, y: 16 - bob, w: 4, head: { x: hx, y: hy, w: 11 } };
  },

  imp(p) {
    const { rect, ctx, walking, fighting, stride, bob, slam, lean, phase, look, skin, dark } = p;
    // Wings flap and tail whips behind the body.
    const flap = Math.sin(phase * (walking ? 3 : fighting ? 4 : 1.5)) * 3;
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(20, 17 - bob); ctx.lineTo(30, 8 + flap - bob); ctx.lineTo(27, 20 - bob); ctx.lineTo(22, 22 - bob);
    ctx.closePath(); ctx.fill();
    const tail = Math.sin(phase * 2.5) * 3;
    rect(skin, 21, 24, 4, 2);
    rect(skin, 25, 22 + tail * 0.4, 3, 2);
    rect(look.cloth, 28, 20 + tail * 0.7, 2, 3);               // tail tip

    const frontX = 11 + (walking ? stride * 2.5 : fighting ? -1 : 0);
    const backX = 16 - (walking ? stride * 2.5 : 0);
    const frontLift = walking ? Math.max(0, Math.cos(phase)) * 2 : 0;
    const backLift = walking ? Math.max(0, -Math.cos(phase)) * 2 : 0;
    rect(dark, backX + 1, 25, 2, 5 - backLift);
    p.foot(backX, backLift, 4, '#2a0f0f');
    rect(skin, frontX + 1, 25, 2, 5 - frontLift);
    p.foot(frontX, frontLift, 4, '#2a0f0f');

    p.arm(18, 18 - bob, walking ? -stride * 0.8 : fighting ? 0.4 : Math.sin(phase * 0.5) * 0.15, false, 2);

    const torsoY = 17 - bob;
    rect(skin, 13 - lean, torsoY, 7, 8);
    rect(look.cloth, 13 - lean, torsoY + 5, 7, 3);

    const hx = 10 - lean - slam;
    const hy = 6 + (walking ? Math.sin(phase * 2) * 1.2 : fighting ? Math.sin(phase * 3) * 0.6 : 0) - bob;
    ctx.fillStyle = '#f2ead0';                                  // curved horns
    ctx.beginPath(); ctx.moveTo(hx + 2, hy + 1); ctx.lineTo(hx - 1, hy - 5); ctx.lineTo(hx + 4, hy); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(hx + 8, hy + 1); ctx.lineTo(hx + 11, hy - 5); ctx.lineTo(hx + 6, hy); ctx.closePath(); ctx.fill();
    rect(skin, hx, hy, 11, 9);                                  // big head
    rect(dark, hx + 1, hy + 8, 9, 1);
    rect('#fff9a8', hx + 1, hy + 3, 3, 3);                      // big glowing eyes
    rect('#fff9a8', hx + 6, hy + 3, 3, 3);
    rect('#1a0000', hx + 2, hy + 4, 1, 2);
    rect('#1a0000', hx + 7, hy + 4, 1, 2);
    rect('#1a0000', hx + 3, hy + 7, 5, 1);                      // grin
    rect('#fff', hx + 4, hy + 7, 1, 1);
    rect('#fff', hx + 6, hy + 7, 1, 1);
    return { x: 11 - lean, y: 18 - bob, w: 2, head: { x: hx, y: hy, w: 11 } };
  },
};

/**
 * Animates a monster on a MONSTER_W x MONSTER_H canvas.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {MonsterLook} look
 * @returns {{update(dt: number, mode: 'walk'|'fight'|'idle'): boolean}}
 *   `update` redraws and returns true on the frame the weapon lands.
 */
export function createMonster(canvas, look) {
  canvas.width = MONSTER_W;
  canvas.height = MONSTER_H;
  const ctx = canvas.getContext('2d');
  const skin = look.skin;
  const dark = shade(skin, look.kind === 'skeleton' ? -70 : -45);
  const drawBody = BODIES[look.kind] || BODIES.goblin;

  let phase = Math.random() * Math.PI * 2;
  let swing = 0;
  let mode = 'walk';

  function rect(color, x, y, w, h) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  function arm(shoulderX, shoulderY, angle, withWeapon, width) {
    ctx.save();
    ctx.translate(Math.round(shoulderX), Math.round(shoulderY));
    ctx.rotate(angle);
    rect(dark, -1, 0, width, 6);                       // forearm
    rect(skin, -1, 5, width, 3);                       // hand
    if (withWeapon) {
      ctx.translate(0, 7);
      drawWeapon(ctx, look.weapon);
    }
    ctx.restore();
  }

  function foot(x, lift, width, color = '#1d1410') {
    rect(color, x, 29 - lift, width, 3);
  }

  // Bosses wear a gold crown on top of the head.
  function drawCrown(head) {
    rect('#b8860b', head.x, head.y - 2, head.w, 2);
    rect('#ffd166', head.x, head.y - 2, head.w, 1);
    for (const dx of [0, Math.floor(head.w / 2) - 1, head.w - 2]) {
      rect('#ffd166', head.x + dx, head.y - 5, 2, 3);
    }
    rect('#ff3b3b', head.x + Math.floor(head.w / 2) - 1, head.y - 2, 2, 1);
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, MONSTER_W, MONSTER_H);
    ctx.translate(OFFSET_X, OFFSET_Y);
    const walking = mode === 'walk';
    const fighting = mode === 'fight';
    const stride = walking ? Math.sin(phase) : 0;
    const bob = walking ? Math.abs(Math.sin(phase)) : Math.sin(phase * 0.5) * 0.5;
    const slam = fighting ? clamp01((swing - 0.45) / 0.15) * (swing < SWING_IMPACT + 0.1 ? 1 : 0) : 0;
    const lean = fighting ? 1 + slam : 0;

    const shoulder = drawBody({
      ctx, rect, arm, foot, walking, fighting, stride, bob, slam, lean, phase, look, skin, dark,
    });

    if (look.boss) drawCrown(shoulder.head);

    // Weapon arm (front): carries the weapon, drives the attack.
    const carry = walking ? 1.0 + stride * 0.5 : 1.0 + Math.sin(phase * 0.5) * 0.1;
    arm(shoulder.x, shoulder.y, fighting ? swingAngle(swing) : carry, true, shoulder.w);
  }

  draw();

  return {
    update(dt, nextMode) {
      if (nextMode !== mode) {
        mode = nextMode;
        if (mode !== 'fight') swing = 0;
      }
      phase += dt * (mode === 'walk' ? 0.011 : 0.004);
      let landed = false;
      if (mode === 'fight') {
        const prev = swing;
        swing = (swing + dt / SWING_MS) % 1;
        landed = prev < SWING_IMPACT && swing >= SWING_IMPACT;
      }
      draw();
      return landed;
    },
  };
}
