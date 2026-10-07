// Draws the spirit orb shown for each running agent: a glowing sphere with a
// soft halo. It is painted once; floating and glow pulsing are CSS animations
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

/** Paints a 32x32 orb onto `canvas` with the agent's colour. */
export function drawMinionSprite(canvas, hero, index = 0) {
  const ctx = canvas.getContext('2d');
  const { bright, mid, dim } = orbPalette(hero, index);
  const cx = 16;
  const cy = 16;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Soft halo.
  const halo = ctx.createRadialGradient(cx, cy, 4, cx, cy, 15);
  halo.addColorStop(0, `${bright}66`);
  halo.addColorStop(1, `${bright}00`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx.fill();

  // Sphere, lit from the upper left.
  const body = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, 9);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.25, bright);
  body.addColorStop(0.7, mid);
  body.addColorStop(1, dim);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fill();

  // Rim light and specular dot.
  ctx.strokeStyle = `${bright}aa`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#ffffffcc';
  ctx.beginPath();
  ctx.ellipse(cx - 3, cy - 4, 2, 1.4, -0.6, 0, Math.PI * 2);
  ctx.fill();
}
