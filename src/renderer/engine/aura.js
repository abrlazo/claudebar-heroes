// Super Saiyan-style power aura drawn behind the hero (level 15+).
//
// Jagged flame spikes lick upward from the hero's feet, sparks rise, lightning
// crackles around the body (only once `setLightning(true)`, from level 25), and `burst()` plays a shockwave when the hero powers
// up to a new aura tier. It idles low while the hero sleeps (and lies down with
// the hero: `setLying`, the footprint glides from the standing to the lying body) and
// flares up while Claude is working. Drawn at half resolution so it stays chunky like the rest
// of the pixel art. Colours come from prestige.js.

// Canvas size in canvas px (the CSS box in styles.css is 2x). W is wide enough for the lying body
// (aura x 9-29) plus flames and the burst ring; the standing look is anchored on its own centre.
const W = 34;
const H = 55;
const BASE = 51;    // ground: the hero's feet (sprite y 29) in aura-canvas pixels
const SEC_POWER = 4;   // ease rate of the intensity (1/s)
const SEC_LIE = 8;     // ease rate of the lying pose (1/s, about 0.25 s)
const BURST_SECONDS = 0.9;

// The hero's body in aura-canvas pixels. The aura canvas starts 3px left of and 22px above the sprite
// (32x30), so aura = sprite + (3, 22). Everything below derives from these two body footprints, so the
// aura hugs the body in both poses. Measured on the rendered hero: standing torso and head span sprite
// x 9-16 and y 9-29; lying (the sprite is turned 90deg, head to the left) spans x 6-26, y 19-28.
const BODY_W = 9;
const STAND = { len: BODY_W, thick: 20, cx: 15.5, cy: 42, glow: 1.2, burst: 1.1, core: 0.78, spread: 0.75, spikes: 5 };
const LIE = { len: 20, thick: 9, cx: 19, cy: 46, glow: 0.6, burst: 0.7, core: 0.5, spread: 0.5, spikes: 7 };
const MAX_SPIKES = LIE.spikes;

// What the drawing needs for one pose: the body footprint plus the sizes derived from it.
const shape = (b) => ({
  len: b.len, thick: b.thick, cx: b.cx, cy: b.cy,
  half: b.len * b.spread,            // flame centres spread +-half around cx
  lightMax: Math.round(b.len * 1.1), // lightning never strays further than this from cx
  glowR: b.len * b.glow,
  burstRx: Math.round(b.len * b.burst), burstRy: b.thick * 1.2, // power-up ring
  coreRx: Math.round(b.len * b.core), coreRy: b.thick * 0.9,    // white flash inside it
});
const SHAPE_STAND = shape(STAND);
const SHAPE_LIE = shape(LIE);
const SHAPE_KEYS = Object.keys(SHAPE_STAND);
const lerp = (a, b, t) => a + (b - a) * t;

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mixWhite = (rgb, t) => rgb.map((v) => Math.round(v + (255 - v) * t));
const rgba = (rgb, a) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, a))})`;

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{setColor(hex: string|null): void, setLightning(on: boolean): void,
 *            setActive(active: boolean): void, burst(): void, update(dtMs: number): void}}
 */
export function createAura(canvas) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  let rgb = null;
  let time = 0;
  let power = 0.35;      // smoothed intensity
  let target = 0.35;     // 1 while awake, low while asleep
  let sparkDebt = 0;
  let boltIn = 0.6;
  let bolt = null;       // { points, life }
  let lightning = false; // lightning only crackles from level 25 (see prestige.js)
  let burstT = -1;       // seconds since the burst began, -1 when idle
  let lie = 0;           // 0 standing .. 1 lying, smoothed
  let lieTarget = 0;
  const g = { ...SHAPE_STAND }; // the body footprint at the current `lie` (reused every frame)
  const sparks = [];

  function drawSpikes(surge) {
    const scale = (0.4 + 0.6 * power) * surge;
    const layers = [
      { width: 5, height: 1, white: 0, alpha: 0.5 },
      { width: 4, height: 0.68, white: 0.45, alpha: 0.72 },
      { width: 2, height: 0.4, white: 0.85, alpha: 0.9 },
    ];
    const last = STAND.spikes - 1;
    for (const layer of layers) {
      ctx.fillStyle = rgba(mixWhite(rgb, layer.white), layer.alpha * (0.5 + 0.5 * power));
      for (let i = 0; i < MAX_SPIKES; i++) {
        // Standing: 5 spikes. Lying: 7 along the longer body; the two extra ones grow out of the
        // last spike's place (frac 1) as `lie` rises, so nothing pops.
        const extra = i > last;
        const frac = lerp(Math.min(i, last) / last, i / (LIE.spikes - 1), lie); // 0..1 along the body
        const weight = extra ? lie : 1;
        if (weight < 0.02) continue;
        const x = g.cx - g.half + frac * 2 * g.half;
        const centre = 1 - Math.abs(frac - 0.5) / 0.5; // 0 at the ends, 1 in the middle
        const flicker = 1 + 0.18 * Math.sin(time * 9 + i * 1.9) + 0.1 * Math.sin(time * 17 + i * 3.1);
        const standH = (14 + 18 * centre) * scale * layer.height * flicker;
        // Lying, the flames rise from the top of the body: its thickness plus half the usual height.
        const h = lerp(standH, LIE.thick + 0.5 * standH, lie) * weight;
        const sway = Math.sin(time * 5 + i);
        ctx.beginPath();
        ctx.moveTo(x - layer.width / 2, BASE);
        ctx.lineTo(x + sway, BASE - h);
        ctx.lineTo(x + layer.width / 2, BASE);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function drawSparks(seconds) {
    sparkDebt += seconds * 26 * power;
    while (sparkDebt >= 1 && sparks.length < 28) {
      sparkDebt -= 1;
      const x = g.cx + (Math.random() - 0.5) * g.len;
      const r = Math.random();
      sparks.push({
        x,
        y: BASE - lerp(4 + r * 16, LIE.thick + r * 4, lie), // lying: off the top of the body
        vx: (Math.random() - 0.5) * 3,
        vy: -(14 + Math.random() * 16),
        life: 0.5 + Math.random() * 0.7,
        age: 0,
      });
    }
    sparkDebt = Math.min(sparkDebt, 2);
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.age += seconds;
      if (s.age >= s.life) { sparks.splice(i, 1); continue; }
      s.x += s.vx * seconds;
      s.y += s.vy * seconds;
      const t = s.age / s.life;
      ctx.fillStyle = rgba(mixWhite(rgb, 1 - t), (1 - t) * (0.5 + 0.5 * power));
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, t < 0.4 ? 2 : 1);
    }
  }

  function drawLightning(seconds) {
    if (lightning && power > 0.8) {
      boltIn -= seconds;
      if (boltIn <= 0 && !bolt) {
        boltIn = 0.5 + Math.random();
        const side = Math.random() < 0.5 ? -1 : 1;
        let x = g.cx + side * (5 + Math.random() * 2) * (g.len / BODY_W);
        let y = BASE - g.thick - 1 + Math.random() * 18;
        const points = [[x, y]];
        for (let i = 0; i < 5; i++) {
          x += side * (0.3 + Math.random()) * (Math.random() > 0.5 ? 1 : -0.4);
          x = Math.max(g.cx - g.lightMax, Math.min(g.cx + g.lightMax, x));
          y -= 3 + Math.random() * 3;
          points.push([x, y]);
        }
        bolt = { points, life: 0.14 };
      }
    }
    if (!bolt) return;
    bolt.life -= seconds;
    if (bolt.life <= 0) { bolt = null; return; }
    ctx.lineJoin = 'miter';
    for (const [width, style] of [[2.5, rgba(rgb, 0.55)], [1, 'rgba(255, 255, 255, 0.95)']]) {
      ctx.lineWidth = width;
      ctx.strokeStyle = style;
      ctx.beginPath();
      bolt.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
  }

  function drawBurst() {
    const p = burstT / BURST_SECONDS;
    ctx.strokeStyle = rgba(mixWhite(rgb, 0.4), 1 - p);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(g.cx, g.cy, p * g.burstRx, p * g.burstRy, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgba([255, 255, 255], 0.45 * (1 - p));
    ctx.beginPath();
    ctx.ellipse(g.cx, g.cy, g.coreRx, g.coreRy, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Blend the standing and lying footprints into `g` (no allocation).
  function blendShape() {
    for (let i = 0; i < SHAPE_KEYS.length; i++) {
      const k = SHAPE_KEYS[i];
      g[k] = lerp(SHAPE_STAND[k], SHAPE_LIE[k], lie);
    }
  }
  function snapLie() { lie = lieTarget; blendShape(); }

  return {
    /** Aura colour (CSS hex) or null to switch the aura off. */
    setColor(hex) {
      const wasOff = !rgb;
      rgb = hex ? hexToRgb(hex) : null;
      if (rgb && wasOff) snapLie(); // not drawn while off, so it never glided: start in the current pose
      if (!rgb) {
        ctx.clearRect(0, 0, W, H);
        sparks.length = 0;
        bolt = null;
        burstT = -1;
      }
    },

    /** Lightning around the aura on or off (on from level 25). */
    setLightning(on) {
      lightning = !!on;
      if (!lightning) bolt = null;
    },

    /** Flares up while Claude works; idles low while the hero sleeps. */
    setActive(active) {
      target = active ? 1 : 0.35;
    },

    /** Lies down with the hero (true) or stands up again (false); glides unless motion is reduced. */
    setLying(on) {
      lieTarget = on ? 1 : 0;
      if (!rgb || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) snapLie();
    },

    /** Power-up shockwave, played when the aura reaches a new tier. */
    burst() {
      if (rgb) burstT = 0;
    },

    update(dtMs) {
      if (!rgb) return;
      const seconds = Math.min(dtMs, 100) / 1000;
      time += seconds;
      power += (target - power) * Math.min(1, seconds * SEC_POWER);
      if (lie !== lieTarget) {
        lie += (lieTarget - lie) * Math.min(1, seconds * SEC_LIE);
        if (Math.abs(lieTarget - lie) < 0.003) lie = lieTarget;
        blendShape();
      }
      let surge = 1;
      if (burstT >= 0) {
        burstT += seconds;
        if (burstT >= BURST_SECONDS) burstT = -1;
        else surge = 1 + 0.5 * (1 - burstT / BURST_SECONDS);
      }
      ctx.clearRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(g.cx, g.cy, 2, g.cx, g.cy, g.glowR);
      glow.addColorStop(0, rgba(rgb, 0.4 * power));
      glow.addColorStop(1, rgba(rgb, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      drawSpikes(surge);
      drawSparks(seconds);
      drawLightning(seconds);
      if (burstT >= 0) drawBurst();
    },
  };
}
