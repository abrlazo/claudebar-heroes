// Draws the spirit orb shown for each running agent: a small wisp (bright
// core, glow, short tail). It is painted once; orbiting, wobble and glow pulsing are CSS animations
// (see styles.css) so the motion stays smooth and costs no per-frame drawing.

const ORB_COLORS = [
  { bright: '#ff8a3d', mid: '#ff6b1a', dim: '#a82f00' },
  { bright: '#6be3f2', mid: '#26b8cc', dim: '#00667a' },
  { bright: '#ff5db1', mid: '#e0207f', dim: '#7a0a45' },
  { bright: '#ffe14a', mid: '#ffb800', dim: '#8a5a00' },
  { bright: '#b08cff', mid: '#7c3aed', dim: '#3f1a8a' },
];

/** Consistent palette for an agent (by its index; falls back to the hero seed). */
export function orbPalette(hero, index) {
  const i = Number.isInteger(index) ? index : (hero.seed?.charCodeAt(0) || 0);
  return ORB_COLORS[i % ORB_COLORS.length];
}

/** Paints a 24x24 wisp onto `canvas` with the agent's colour: bright core, soft glow, tail to the upper right. */
export function drawMinionSprite(canvas, hero, index = 0) {
  const ctx = canvas.getContext('2d');
  const { bright } = orbPalette(hero, index);
  const cx = 10;
  const cy = 14;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const blob = (x, y, r, color, alpha) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, `${bright}00`);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  // Tail: fading blobs that taper away to the upper right.
  blob(cx + 5, cy - 4, 4.5, `${bright}ff`, 0.9);
  blob(cx + 8, cy - 7, 3, `${bright}dd`, 0.7);
  blob(cx + 11, cy - 9, 2, `${bright}bb`, 0.5);
  // Soft glow, then the bright core (about 3px).
  blob(cx, cy, 10, `${bright}cc`, 1);
  blob(cx, cy, 5, `${bright}ff`, 1);
  blob(cx, cy, 3.5, '#ffffff', 1);
  ctx.globalAlpha = 1;
}
