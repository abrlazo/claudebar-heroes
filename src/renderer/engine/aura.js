// Super Saiyan-style power aura drawn behind the hero (level 15+).
//
// Jagged flame spikes lick upward from the hero's feet, sparks rise, lightning
// crackles around the body (only once `setLightning(true)`, from level 25), and `burst()` plays a shockwave when the hero powers
// up to a new aura tier. It idles low while the hero sleeps and flares up while
// Claude is working. Drawn at half resolution so it stays chunky like the rest
// of the pixel art. Colours come from prestige.js.

const W = 56;
const H = 55;
// Where the hero's body sits in aura-canvas pixels. The hero sprite (32x30) is
// drawn left-of-centre (torso and head span x 9-16, feet at y 29) and the aura
// canvas starts 12px left of and 22px above the sprite, so: x = 12 + 12.5, y = 22 + n.
const CX = 24.5;    // centre of the body
const BASE = 51;    // feet
const BODY_Y = 42;  // middle of the body (head top to feet)
const SPIKES = 7;
const BURST_SECONDS = 0.9;

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
  const sparks = [];

  function drawSpikes(surge) {
    const scale = (0.4 + 0.6 * power) * surge;
    const layers = [
      { width: 8, height: 1, white: 0, alpha: 0.5 },
      { width: 6, height: 0.68, white: 0.45, alpha: 0.72 },
      { width: 3, height: 0.4, white: 0.85, alpha: 0.9 },
    ];
    for (const layer of layers) {
      ctx.fillStyle = rgba(mixWhite(rgb, layer.white), layer.alpha * (0.5 + 0.5 * power));
      for (let i = 0; i < SPIKES; i++) {
        const x = CX - 16 + (i * 32) / (SPIKES - 1);
        const centre = 1 - Math.abs(i - (SPIKES - 1) / 2) / ((SPIKES - 1) / 2); // 0 at the edges, 1 in the middle
        const flicker = 1 + 0.18 * Math.sin(time * 9 + i * 1.9) + 0.1 * Math.sin(time * 17 + i * 3.1);
        const h = (14 + 18 * centre) * scale * layer.height * flicker;
        const sway = Math.sin(time * 5 + i) * 1.5;
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
      sparks.push({
        x: CX + (Math.random() - 0.5) * 30,
        y: BASE - 4 - Math.random() * 16,
        vx: (Math.random() - 0.5) * 6,
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
        let x = CX + side * (10 + Math.random() * 4);
        let y = 30 + Math.random() * 18;
        const points = [[x, y]];
        for (let i = 0; i < 5; i++) {
          x += side * (1 + Math.random() * 3) * (Math.random() > 0.5 ? 1 : -0.4);
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
    ctx.ellipse(CX, BODY_Y, p * 30, p * 24, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgba([255, 255, 255], 0.45 * (1 - p));
    ctx.beginPath();
    ctx.ellipse(CX, BODY_Y, 16, 18, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  return {
    /** Aura colour (CSS hex) or null to switch the aura off. */
    setColor(hex) {
      rgb = hex ? hexToRgb(hex) : null;
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

    /** Power-up shockwave, played when the aura reaches a new tier. */
    burst() {
      if (rgb) burstT = 0;
    },

    update(dtMs) {
      if (!rgb) return;
      const seconds = Math.min(dtMs, 100) / 1000;
      time += seconds;
      power += (target - power) * Math.min(1, seconds * 4);
      let surge = 1;
      if (burstT >= 0) {
        burstT += seconds;
        if (burstT >= BURST_SECONDS) burstT = -1;
        else surge = 1 + 0.5 * (1 - burstT / BURST_SECONDS);
      }
      ctx.clearRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(CX, BODY_Y, 3, CX, BODY_Y, 24);
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
