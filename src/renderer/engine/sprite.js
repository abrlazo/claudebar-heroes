// Draws a generated hero (see heroes.js) as an animated pixel sprite.
//
// The hero is built from parts (legs, torso, head, arms, weapon) placed at
// angles that change per animation frame, so limbs swing, the head bobs and
// the weapon arcs through each attack. Every frame gets a 1px dark outline
// for a crisp modern pixel look.

const SPR_W = 32;
const SPR_H = 30;
const OUTLINE = [20, 18, 31];

const POSES = {
  idle: {
    frameMs: 600,
    frames: [
      { bob: 0, fa: 80, ba: 100, fl: 90, bl: 90 },
      { bob: 0, fa: 84, ba: 96, fl: 90, bl: 90, breathe: 1 },
    ],
  },
  run: {
    frameMs: 110,
    frames: [
      { bob: 0, fa: 125, ba: 60, fl: 55, bl: 125, cape: 0 },
      { bob: -1, fa: 95, ba: 95, fl: 90, bl: 90, cape: 1 },
      { bob: 0, fa: 60, ba: 125, fl: 125, bl: 55, cape: 0 },
      { bob: -1, fa: 95, ba: 95, fl: 90, bl: 90, cape: 1 },
    ],
  },
  fight: {
    frameMs: 400,
    frames: [
      { bob: 0, fa: 40, ba: 100, fl: 70, bl: 110, ready: true },
      { bob: 1, fa: 45, ba: 104, fl: 70, bl: 110, ready: true },
    ],
  },
  attack: {
    frameMs: 75,
    once: 'fight',
    frames: [
      { bob: 0, fa: -110, ba: 110, fl: 70, bl: 110, swing: 'windup' },
      { bob: 0, fa: 10, ba: 120, fl: 45, bl: 115, swing: 'strike', lean: 1 },
      { bob: 0, fa: 55, ba: 105, fl: 60, bl: 110, swing: 'follow' },
    ],
  },
  victory: {
    frameMs: 180,
    frames: [
      { bob: -2, fa: -60, ba: -115, fl: 80, bl: 100, swing: 'raised' },
      { bob: 0, fa: -70, ba: -105, fl: 90, bl: 90, swing: 'raised' },
    ],
  },
  sleep: {
    frameMs: 1200,
    frames: [
      { bob: 0, fa: 90, ba: 90, fl: 90, bl: 90, eyesClosed: true },
      { bob: 0, fa: 90, ba: 90, fl: 90, bl: 90, eyesClosed: true, breathe: 1 },
    ],
  },
};

// Weapon angle per weapon and swing phase (degrees; 0 = forward, -90 = up).
const WEAPON_ANGLES = {
  sword: { rest: -60, ready: -30, windup: -150, strike: 5, follow: 50, raised: -85 },
  daggers: { rest: -30, ready: -10, windup: -120, strike: 0, follow: 40, raised: -80 },
  staff: { rest: -95, ready: -70, windup: -130, strike: -20, follow: -60, raised: -90 },
  hammer: { rest: -70, ready: -50, windup: -160, strike: 20, follow: 60, raised: -90 },
  axe: { rest: -70, ready: -50, windup: -160, strike: 15, follow: 55, raised: -90 },
  spear: { rest: -25, ready: -5, windup: -20, strike: 0, follow: 0, raised: -90 },
  scythe: { rest: -55, ready: -40, windup: -150, strike: 0, follow: 45, raised: -90 },
  bow: {},
  fists: {},
};

function shade(c, f) {
  const n = parseInt(c.slice(1), 16);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

// `glow`, when given, also receives a white copy of every weapon pixel (the weapon layer).
function drawHero(b, hero, frame, glow = null) {
  const c = hero.colors;
  const y0 = frame.bob || 0;
  const lean = frame.lean || 0;
  const rect = (x, y, w, h, col) => { b.fillStyle = col; b.fillRect(Math.round(x), Math.round(y), w, h); };
  const weaponRect = (x, y, w, h, col) => {
    rect(x, y, w, h, col);
    if (glow) { glow.fillStyle = '#fff'; glow.fillRect(Math.round(x), Math.round(y), w, h); }
  };

  // Thick pixel line from (x, y) at angle, returns the end point.
  const limb = (x, y, angle, len, col, thick = 2) => {
    const r = (angle * Math.PI) / 180;
    let ex = x;
    let ey = y;
    for (let i = 0; i <= len; i++) {
      ex = Math.round(x + Math.cos(r) * i);
      ey = Math.round(y + Math.sin(r) * i);
      rect(ex, ey, thick, thick, col);
    }
    return [ex, ey];
  };

  const sleeveCol = hero.body === 'bare' ? c.skin : hero.body === 'robe' ? c.primary : shade(c.primary, -0.1);
  const pantsCol = hero.body === 'bare' ? c.primary : c.pants;

  // Cape (behind everything)
  if (hero.cape) {
    const flap = frame.cape || 0;
    rect(8, 18 + y0, 3, 7, shade(c.secondary, -0.15));
    rect(7 - flap, 20 + y0, 2, 5 + flap, shade(c.secondary, -0.3));
  }

  // Back arm and back leg (darker: they're further away)
  const backHand = limb(11, 19 + y0, frame.ba, 4, shade(sleeveCol, -0.35));
  rect(backHand[0], backHand[1], 2, 2, shade(c.skin, -0.25));
  if (hero.weapon === 'daggers') weapon(b, weaponRect, hero, 'daggers', backHand, angleFor(hero, frame, true), true);

  const legs = (hipX, angle, dark) => {
    const end = limb(hipX, 24 + y0, angle, 3, shade(pantsCol, dark ? -0.35 : 0));
    rect(end[0], Math.min(end[1] + 1, 28), 2, 2, shade(c.boots, dark ? -0.3 : 0));
    rect(end[0] + 1, Math.min(end[1] + 2, 28), 2, 1, shade(c.boots, dark ? -0.3 : 0));
  };
  legs(11, frame.bl, true);
  legs(13, frame.fl, false);

  // Torso
  const tx = 10 + lean;
  const ty = 18 + y0;
  if (hero.body === 'robe') {
    const sway = frame.cape ? 1 : 0;
    rect(tx, ty, 6, 6, c.primary);
    rect(tx - 1 - sway, ty + 6, 8, 4, c.primary);
    rect(tx - 1 - sway, ty + 9, 8, 1, c.secondary);
    rect(tx, ty + 4, 6, 1, c.secondary);
    rect(tx + 3, ty, 1, 4, shade(c.secondary, 0.2));
  } else {
    const torsoCol = hero.body === 'bare' ? c.skin : c.primary;
    rect(tx, ty, 6, 6, torsoCol);
    rect(tx, ty + 5, 6, 1, shade(torsoCol, -0.25));
    if (hero.body === 'armor') {
      rect(tx + 2, ty + 1, 3, 3, c.secondary);
      rect(tx + 2, ty + 1, 3, 1, shade(c.secondary, 0.35));
      rect(tx, ty + 5, 6, 1, shade(c.primary, -0.45));
    } else if (hero.body === 'leather') {
      for (let i = 0; i < 5; i++) rect(tx + 1 + i, ty + i, 1, 1, shade(c.secondary, -0.2));
      rect(tx, ty + 4, 6, 1, c.secondary);
    } else if (hero.body === 'bare') {
      rect(tx + 1, ty + 1, 2, 1, shade(c.skin, -0.15));
      rect(tx, ty + 5, 6, 1, c.secondary);
    } else if (hero.body === 'gi') {
      rect(tx + 3, ty, 2, 2, c.skin);
      rect(tx + 4, ty + 2, 1, 1, c.skin);
      rect(tx, ty + 4, 6, 1, '#1b1b1b');
      rect(tx - 1, ty + 4, 1, 2, '#1b1b1b');
    }
  }

  // Shield on the far arm
  if (hero.shield) {
    const [sx, sy] = backHand;
    rect(sx - 1, sy - 3, 4, 5, c.secondary);
    rect(sx - 1, sy - 3, 4, 1, shade(c.secondary, 0.35));
    rect(sx, sy - 1, 2, 1, c.accent);
  }

  // Head
  const hx = 9 + lean;
  const hy = 12 + y0;
  rect(hx, hy, 7, 6, c.skin);
  rect(hx, hy + 5, 7, 1, shade(c.skin, -0.18));
  if (frame.eyesClosed) rect(hx + 4, hy + 3, 2, 1, '#3a2a2a');
  else {
    rect(hx + 5, hy + 2, 1, 2, '#1b1b2f');
    rect(hx + 6, hy + 4, 1, 1, shade(c.skin, -0.2));
  }
  drawHair(rect, hero, hx, hy, frame);
  drawGear(rect, hero, hx, hy);
  if (hero.stache) rect(hx + 4, hy + 4, 3, 1, '#3b2418');
  if (hero.glasses) {
    const rim = '#1b1b2f';
    rect(hx + 4, hy + 1, 3, 1, rim);
    rect(hx + 4, hy + 4, 3, 1, rim);
    rect(hx + 4, hy + 2, 1, 2, rim);
    rect(hx + 6, hy + 2, 1, 2, rim);
  }

  // Front arm + weapon
  const armLen = hero.weapon === 'fists' && frame.swing === 'strike' ? 6 : 4;
  const hand = limb(13 + lean, 19 + y0, frame.fa, armLen, sleeveCol);
  rect(hand[0], hand[1], 2, 2, hero.weapon === 'fists' ? c.accent : c.skin);
  if (hero.body === 'armor') rect(12 + lean, 18 + y0, 3, 2, c.secondary);
  weapon(b, weaponRect, hero, hero.weapon, hand, angleFor(hero, frame, false), false, frame);
}

function angleFor(hero, frame, back) {
  const table = WEAPON_ANGLES[hero.weapon] || {};
  const key = frame.swing || (frame.ready ? 'ready' : 'rest');
  const a = table[key] ?? table.rest ?? -60;
  return back ? a - 25 : a;
}

function drawHair(rect, hero, hx, hy, frame) {
  const col = hero.colors.hair;
  if (hero.hair === 'bald' || hero.gear === 'helmet' || hero.gear === 'plume' || hero.gear === 'hood' || hero.gear === 'vader' || hero.gear === 'fullmask') return;
  rect(hx, hy - 1, 7, 2, col);
  rect(hx, hy + 1, 2, 2, col);
  rect(hx + 6, hy, 1, 1, col);
  if (hero.hair === 'long') rect(hx - 1, hy, 3, 6, col);
  if (hero.hair === 'spiky') {
    rect(hx, hy - 2, 1, 1, col);
    rect(hx + 2, hy - 2, 1, 1, col);
    rect(hx + 4, hy - 2, 1, 1, col);
    rect(hx - 1, hy - 1, 1, 1, col);
  }
  if (hero.hair === 'ponytail') {
    const swing = frame.cape ? 1 : 0;
    rect(hx - 2, hy + 1 + swing, 2, 3, col);
  }
}

function drawGear(rect, hero, hx, hy) {
  const c = hero.colors;
  switch (hero.gear) {
    case 'helmet':
    case 'plume':
      rect(hx - 1, hy - 2, 8, 4, c.metal);
      rect(hx - 1, hy - 2, 8, 1, shade(c.metal, 0.4));
      rect(hx - 1, hy + 1, 3, 3, shade(c.metal, -0.15));
      rect(hx + 6, hy + 1, 1, 2, shade(c.metal, -0.3));
      if (hero.gear === 'plume') {
        rect(hx + 1, hy - 4, 2, 2, c.accent);
        rect(hx - 2, hy - 5, 4, 1, c.accent);
        rect(hx - 3, hy - 4, 2, 1, shade(c.accent, -0.2));
      }
      break;
    case 'vader': {
      const shell = '#16161d';
      rect(hx - 1, hy - 2, 9, 5, shell);                       // dome
      rect(hx, hy - 2, 5, 1, '#3d3d4d');                       // highlight
      rect(hx - 1, hy + 3, 3, 3, shell);                       // back flare
      rect(hx + 2, hy + 2, 5, 4, '#1d1d26');                   // face mask
      rect(hx + 4, hy + 2, 2, 1, '#000');                      // eye lenses
      rect(hx + 4, hy + 3, 1, 1, '#000');
      rect(hx + 5, hy + 4, 2, 1, '#5b6170');                   // grille
      rect(hx + 5, hy + 5, 2, 1, '#2c303a');
      break;
    }
    case 'wizard':
      rect(hx - 2, hy, 11, 1, shade(c.primary, -0.2));
      rect(hx, hy - 1, 7, 1, c.accent);
      rect(hx + 1, hy - 2, 5, 1, c.primary);
      rect(hx + 1, hy - 3, 4, 1, c.primary);
      rect(hx + 1, hy - 4, 3, 1, c.primary);
      rect(hx, hy - 5, 3, 1, c.primary);
      rect(hx - 1, hy - 6, 2, 1, c.primary);
      rect(hx + 2, hy - 3, 1, 1, c.accent);
      break;
    case 'hood': {
      const hood = shade(c.primary, -0.3);
      rect(hx - 1, hy - 2, 8, 3, hood);
      rect(hx - 1, hy + 1, 3, 6, hood);
      rect(hx + 6, hy - 1, 1, 2, hood);
      break;
    }
    case 'mask':
      rect(hx + 3, hy + 4, 4, 2, '#22222e');
      break;
    case 'headband':
      rect(hx, hy + 1, 7, 1, c.accent);
      rect(hx - 2, hy + 1, 2, 1, c.accent);
      rect(hx - 3, hy + 2, 1, 1, c.accent);
      break;
    case 'crown':
      rect(hx + 1, hy - 2, 5, 1, '#f5c542');
      rect(hx + 1, hy - 3, 1, 1, '#f5c542');
      rect(hx + 3, hy - 3, 1, 1, '#f5c542');
      rect(hx + 5, hy - 3, 1, 1, '#f5c542');
      rect(hx + 3, hy - 2, 1, 1, c.accent);
      break;
    case 'strawhat':
      rect(hx, hy - 3, 7, 2, '#e8c15a');                       // crown
      rect(hx - 3, hy - 1, 13, 1, '#e8c15a');                  // brim
      rect(hx, hy - 1, 7, 1, '#c0392b');                       // red band
      break;
    case 'cap':
      rect(hx - 1, hy - 2, 8, 3, c.primary);
      rect(hx + 5, hy + 1, 4, 1, shade(c.primary, -0.25));     // peak
      rect(hx + 3, hy - 2, 2, 2, '#ffffff');                   // badge
      break;
    case 'fullmask':
      rect(hx, hy - 1, 7, 7, c.primary);
      rect(hx, hy + 5, 7, 1, shade(c.primary, -0.2));
      rect(hx + 1, hy, 1, 5, shade(c.primary, -0.35));         // web lines
      rect(hx + 3, hy - 1, 1, 3, shade(c.primary, -0.35));
      rect(hx + 1, hy + 3, 5, 1, shade(c.primary, -0.35));
      rect(hx + 4, hy + 1, 3, 3, '#14141c');                   // eye rim
      rect(hx + 4, hy + 2, 2, 2, '#ffffff');                   // eye lens
      break;
    case 'ears':
      rect(hx + 1, hy - 4, 1, 3, c.skin);
      rect(hx + 4, hy - 4, 1, 3, c.skin);
      rect(hx + 1, hy - 4, 1, 1, '#1b1b1b');                  // black tips
      rect(hx + 4, hy - 4, 1, 1, '#1b1b1b');
      rect(hx + 4, hy + 4, 1, 1, '#e0412f');                   // red cheek
      break;
    case 'feather':
      rect(hx - 1, hy - 2, 8, 3, c.primary);
      rect(hx + 6, hy, 3, 1, shade(c.primary, -0.2));
      rect(hx - 2, hy - 4, 1, 3, c.accent);
      rect(hx - 3, hy - 5, 1, 2, shade(c.accent, -0.2));
      break;
  }
}

function weapon(b, rect, hero, type, hand, angle, isBack, frame = {}) {
  const c = hero.colors;
  const r = (angle * Math.PI) / 180;
  const dx = Math.cos(r);
  const dy = Math.sin(r);
  const px = -dy; // perpendicular
  const py = dx;
  const [hx, hy] = [hand[0] + 0.5, hand[1] + 0.5];
  const at = (a, p = 0) => [hx + dx * a + px * p, hy + dy * a + py * p];
  const dot = (a, p, col) => { const [x, y] = at(a, p); rect(x, y, 1, 1, col); };
  const line = (from, to, p, col) => { for (let a = from; a <= to; a++) dot(a, p, col); };
  const wood = '#7a4a24';
  const metal = isBack ? shade(c.metal, -0.3) : c.metal;

  switch (type) {
    case 'sword':
      dot(-1, 0, wood);
      dot(1, -1, c.accent); dot(1, 0, c.accent); dot(1, 1, c.accent);
      line(2, 8, 0, metal);
      line(3, 7, 1, shade(metal, -0.25));
      dot(9, 0, '#ffffff');
      break;
    case 'daggers':
      dot(1, 0, c.accent);
      line(2, 4, 0, metal);
      break;
    case 'staff':
      line(-4, 8, 0, wood);
      dot(9, 0, c.accent); dot(10, 0, c.accent); dot(9, 1, c.accent); dot(10, 1, shade(c.accent, 0.5));
      break;
    case 'hammer':
      line(-1, 7, 0, wood);
      for (let a = 6; a <= 8; a++) for (let p = -2; p <= 2; p++) dot(a, p, p === -2 ? shade(metal, 0.3) : metal);
      break;
    case 'axe':
      line(-1, 8, 0, wood);
      for (let a = 5; a <= 8; a++) for (let p = 1; p <= 3; p++) dot(a, p, p === 3 ? '#ffffff' : metal);
      break;
    case 'spear':
      line(-5, 9, 0, wood);
      dot(10, 0, metal); dot(11, 0, metal); dot(12, 0, '#ffffff'); dot(10, 1, metal); dot(10, -1, metal);
      dot(7, 1, c.accent);
      break;
    case 'scythe':
      line(-3, 9, 0, '#3b2a20');
      for (let p = 1; p <= 5; p++) dot(9 - Math.floor(p / 3), p, p === 5 ? '#ffffff' : metal);
      break;
    case 'bow': {
      const pull = frame.swing === 'windup' ? 2 : 0;
      for (let k = -5; k <= 5; k++) rect(hand[0] + 2 - Math.round((k * k) / 12.5), hand[1] + k, 1, 1, wood);
      rect(hand[0] - 1 - pull, hand[1] - 4, 1, 9, '#e8e1d0');
      if (frame.swing === 'windup' || frame.swing === 'strike') {
        const ax = frame.swing === 'strike' ? 6 : 0;
        for (let i = -2 - pull; i <= 4; i++) rect(hand[0] + i + ax, hand[1], 1, 1, wood);
        rect(hand[0] + 5 + ax, hand[1], 1, 1, c.metal);
      }
      break;
    }
  }
}

function outline(b) {
  const img = b.getImageData(0, 0, SPR_W, SPR_H);
  const d = img.data;
  const alpha = new Uint8Array(SPR_W * SPR_H);
  for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
  for (let y = 0; y < SPR_H; y++) {
    for (let x = 0; x < SPR_W; x++) {
      const i = y * SPR_W + x;
      if (alpha[i]) continue;
      const near = (x > 0 && alpha[i - 1]) || (x < SPR_W - 1 && alpha[i + 1])
        || (y > 0 && alpha[i - SPR_W]) || (y < SPR_H - 1 && alpha[i + SPR_W]);
      if (near) d.set([...OUTLINE, 255], i * 4);
    }
  }
  b.putImageData(img, 0, 0);
}

export function createSprite(canvas) {
  canvas.width = SPR_W;
  canvas.height = SPR_H;
  const ctx = canvas.getContext('2d');
  const buffer = document.createElement('canvas');
  buffer.width = SPR_W;
  buffer.height = SPR_H;
  const b = buffer.getContext('2d', { willReadFrequently: true });
  const layer = () => {
    const c = document.createElement('canvas');
    c.width = SPR_W;
    c.height = SPR_H;
    return c;
  };
  const weaponLayer = layer();   // white silhouette of the weapon
  const tintLayer = layer();     // the silhouette in the glow colour
  const composed = layer();      // glow + sprite, drawn to the screen canvas
  const wl = weaponLayer.getContext('2d');
  const tl = tintLayer.getContext('2d');
  const cp = composed.getContext('2d');
  let glowColor = null;
  let glowPhase = 0;
  let glowElapsed = 0;

  let hero = null;
  let pose = 'sleep';
  let frameIndex = 0;
  let elapsed = 0;
  let hurtMs = 0;

  function speedFactor() {
    return pose === 'run' || pose === 'attack' ? Math.min(1.5, Math.max(0.7, 100 / (hero?.stats.spd || 100))) : 1;
  }

  function render() {
    ctx.clearRect(0, 0, SPR_W, SPR_H);
    if (!hero) return;
    b.clearRect(0, 0, SPR_W, SPR_H);
    wl.clearRect(0, 0, SPR_W, SPR_H);
    drawHero(b, hero, POSES[pose].frames[frameIndex], glowColor ? wl : null);
    outline(b);
    if (hurtMs > 0) {
      b.globalCompositeOperation = 'source-atop';
      b.fillStyle = 'rgba(255, 70, 70, 0.65)';
      b.fillRect(0, 0, SPR_W, SPR_H);
      b.globalCompositeOperation = 'source-over';
    }
    cp.clearRect(0, 0, SPR_W, SPR_H);
    if (glowColor) {
      // Tint the weapon silhouette, blur it into a halo under the sprite, and wash the blade itself.
      tl.globalCompositeOperation = 'source-over';
      tl.clearRect(0, 0, SPR_W, SPR_H);
      tl.drawImage(weaponLayer, 0, 0);
      tl.globalCompositeOperation = 'source-in';
      tl.fillStyle = glowColor;
      tl.fillRect(0, 0, SPR_W, SPR_H);
      tl.globalCompositeOperation = 'source-over';
      const pulse = 0.75 + 0.25 * Math.sin(glowPhase);
      cp.save();
      cp.filter = 'blur(2.6px)';
      cp.globalAlpha = pulse;
      for (let i = 0; i < 3; i++) cp.drawImage(tintLayer, 0, 0);
      cp.filter = 'blur(1.1px)';
      for (let i = 0; i < 2; i++) cp.drawImage(tintLayer, 0, 0);
      cp.restore();
      cp.drawImage(buffer, 0, 0);
      cp.globalAlpha = 0.55 * pulse;
      cp.drawImage(tintLayer, 0, 0);
      cp.globalAlpha = 1;
    } else {
      cp.drawImage(buffer, 0, 0);
    }
    if (pose === 'sleep') {
      // Lie down: rotate 90° so the head points back and the body rests on the ground.
      ctx.setTransform(0, -1, 1, 0, -3, 36);
      ctx.drawImage(composed, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      ctx.drawImage(composed, 0, 0);
    }
  }

  return {
    setHero(h) { hero = h; render(); },
    /** Weapon glow colour (CSS colour) or null for none. */
    setPrestige({ glow }) {
      glowColor = glow || null;
      render();
    },
    get pose() { return pose; },
    setPose(name) {
      if (name === pose) return;
      pose = name;
      frameIndex = 0;
      elapsed = 0;
      render();
    },
    attack() {
      pose = 'attack';
      frameIndex = 0;
      elapsed = 0;
      render();
    },
    hurt() { hurtMs = 350; },
    update(dt) {
      if (!hero) return;
      const def = POSES[pose];
      elapsed += dt;
      hurtMs = Math.max(0, hurtMs - dt);
      const step = def.frameMs * speedFactor();
      let changed = hurtMs > 0;
      if (glowColor) {
        glowPhase += dt * 0.004;
        glowElapsed += dt;
        if (glowElapsed >= 90) { glowElapsed = 0; changed = true; }
      }
      while (elapsed >= step) {
        elapsed -= step;
        changed = true;
        if (def.once && frameIndex === def.frames.length - 1) {
          pose = def.once;
          frameIndex = 0;
          break;
        }
        frameIndex = (frameIndex + 1) % def.frames.length;
      }
      if (changed) render();
    },
  };
}

// Still idle frame as a data URL, for roster cards.
export function heroPortrait(hero) {
  const canvas = document.createElement('canvas');
  const s = createSprite(canvas);
  s.setHero(hero);
  s.setPose('idle');
  return canvas.toDataURL();
}



