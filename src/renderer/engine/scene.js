// Procedural pixel-art battlefields drawn on a canvas.
//
// Each map is a stack of parallax layers (far things scroll slowly, near
// things fast) plus a particle effect (leaves, sand, snow, embers,
// fireflies). Scenery is generated from the world position, so it never
// repeats as a tile would: hills, trees and rocks keep changing as the hero
// runs. Weather keeps animating while the hero sleeps.

const PX = 2; // screen pixels per art pixel

// Deterministic 0..1 noise for an integer cell and a seed.
function hash(n, seed) {
  let x = Math.imul((n | 0) ^ Math.imul(seed, 0x27d4eb2d), 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function createScene(canvas, fixedSize) {
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let G = 0; // y of the ground surface
  let theme = THEMES.forest;
  let worldX = 0;
  let t = 0;
  let particles = [];
  let spawnDebt = 0;

  function resize() {
    if (fixedSize) {
      W = fixedSize.width;
      H = fixedSize.height;
    } else {
      const r = canvas.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width / PX));
      H = Math.max(1, Math.round(r.height / PX));
    }
    G = H - 7;
    canvas.width = W;
    canvas.height = H;
    ctx.imageSmoothingEnabled = false;
  }

  // ----- drawing helpers handed to themes -----

  const d = {
    get W() { return W; },
    get H() { return H; },
    get G() { return G; },
    get t() { return t; },
    ctx,

    rect(x, y, w, h, color) {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    },

    sky(top, bottom) {
      const bands = 6;
      const bandH = Math.ceil(G / bands);
      for (let i = 0; i < bands; i++) d.rect(0, i * bandH, W, bandH + 1, mix(top, bottom, i / (bands - 1)));
    },

    disc(cx, cy, r, color) {
      for (let y = -r; y <= r; y++) {
        const half = Math.round(Math.sqrt(r * r - y * y));
        d.rect(cx - half, cy + y, half * 2 + 1, 1, color);
      }
    },

    // Rolling hills/dunes: sum of sines over world x, so it never repeats.
    ridge(color, factor, base, amp, seed, freq = 1) {
      ctx.fillStyle = color;
      const off = worldX * factor;
      for (let x = 0; x < W; x++) {
        const wx = (x + off) * freq;
        const n = Math.sin(wx * 0.031 + seed) + 0.5 * Math.sin(wx * 0.077 + seed * 2.1) + 0.25 * Math.sin(wx * 0.19 + seed * 3.7);
        const y = Math.round(base - amp * (n / 1.75));
        ctx.fillRect(x, y, 1, H - y);
      }
    },

    // Scatter objects along the world: one chance per `cell` art pixels.
    scatter(factor, cell, seed, chance, draw, drift = 0) {
      const left = worldX * factor + drift;
      const first = Math.floor(left / cell) - 2;
      const last = Math.floor((left + W) / cell) + 1;
      for (let i = first; i <= last; i++) {
        if (hash(i, seed) >= chance) continue;
        const x = Math.round(i * cell + hash(i, seed + 1) * cell * 0.6 - left);
        draw(x, hash(i, seed + 2), i);
      }
    },

    // Triangle mountain/volcano, drawn row by row for crisp pixels.
    peak(cx, baseY, w, h, color, capColor, capFrac = 0.3) {
      for (let k = 0; k < h; k++) {
        const half = Math.max(1, Math.round(((k + 1) / h) * (w / 2)));
        d.rect(cx - half, baseY - h + k, half * 2, 1, capColor && k < h * capFrac ? capColor : color);
      }
    },
  };

  function render(dt) {
    t += dt / 1000;
    const p = theme.particles;
    if (p) {
      spawnDebt += (p.rate * dt) / 1000;
      while (spawnDebt >= 1) {
        spawnDebt -= 1;
        if (particles.length < p.max) particles.push(p.spawn(d, false));
      }
      particles = particles.filter((q) => p.update(q, dt / 1000, d));
    }
    theme.draw(d);
    if (p) for (const q of particles) p.draw(q, d);
  }

  resize();

  return {
    resize,
    setTheme(id) {
      theme = THEMES[id] || THEMES.forest;
      worldX = 0;
      // Start with the weather already going instead of an empty sky.
      particles = [];
      const p = theme.particles;
      if (p) for (let i = 0; i < p.max * 0.6; i++) particles.push(p.spawn(d, true));
    },
    // dx in screen pixels the world moved this frame.
    advance(dx) {
      const ax = dx / PX;
      worldX += ax;
      const p = theme.particles;
      if (p) for (const q of particles) q.x -= ax * (p.parallax ?? 0.6);
    },
    render,
    jump(x) { worldX = x; },
    get ctx() { return ctx; },
  };
}

// ----- colour helpers -----

function hex(c) {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, f) {
  const [r1, g1, b1] = hex(a);
  const [r2, g2, b2] = hex(b);
  const m = (x, y) => Math.round(x + (y - x) * f).toString(16).padStart(2, '0');
  return `#${m(r1, r2)}${m(g1, g2)}${m(b1, b2)}`;
}
const rnd = (a, b) => a + Math.random() * (b - a);

// ----- maps -----

const THEMES = {
  forest: {
    draw(d) {
      const { W, H, G } = d;
      d.sky('#6fb8ec', '#d4f0fd');
      // Clouds drift on their own and with the run.
      d.scatter(0.06, 60, 11, 0.6, (cx, r) => {
        const y = 3 + Math.round(r * 8);
        d.rect(cx, y, 14 + r * 6, 3, '#ffffff');
        d.rect(cx + 3, y - 2, 8, 2, '#ffffff');
        d.rect(cx + 1, y + 3, 12 + r * 6, 1, '#e3f3fc');
      }, d.t * 2);
      d.ridge('#9cc9a0', 0.12, G - 12, 6, 1.3);
      d.ridge('#5f9e63', 0.28, G - 6, 4, 4.1, 1.4);
      // Pines
      d.scatter(0.55, 13, 21, 0.7, (x, r) => {
        const h = 9 + Math.round(r * 9);
        d.rect(x + 3, G - 3, 2, 3, '#5b3a1e');
        for (let k = 0; k < 3; k++) {
          const w = 8 - k * 2;
          d.rect(x + 4 - w / 2, G - 3 - (k + 1) * (h / 3), w, h / 3 + 1, k % 2 ? '#3b7d3f' : '#2f6b35');
        }
      });
      // Ground
      d.rect(0, G, W, H - G, '#4f9a3a');
      d.rect(0, G, W, 1, '#7fd35a');
      d.rect(0, H - 2, W, 2, '#3c7a2c');
      d.scatter(1, 5, 31, 0.6, (x, r) => d.rect(x, G - 1 - Math.round(r), 1, 1 + Math.round(r), '#7fd35a'));
      d.scatter(1, 19, 41, 0.35, (x, r) => d.rect(x, G - 1, 1, 1, r > 0.5 ? '#ffd166' : '#ff7eb6'));
    },
    particles: {
      rate: 1.2, max: 8, parallax: 0.8,
      spawn: (d, anywhere) => ({ x: rnd(0, d.W + 20), y: anywhere ? rnd(0, d.G) : -2, vx: rnd(-6, -2), vy: rnd(4, 8), c: Math.random() > 0.5 ? '#e9a23b' : '#7fbf4a' }),
      update: (q, s, d) => { q.x += (q.vx + Math.sin(d.t * 2 + q.y) * 4) * s; q.y += q.vy * s; return q.y < d.G && q.x > -4; },
      draw: (q, d) => d.rect(q.x, q.y, 1, 1, q.c),
    },
  },

  desert: {
    draw(d) {
      const { W, H, G } = d;
      d.sky('#f19a52', '#fde6a8');
      d.disc(Math.round(W * 0.72), 10, 6, '#ffe9a8');
      d.disc(Math.round(W * 0.72), 10, 4, '#fff6d6');
      d.ridge('#eab673', 0.1, G - 11, 5, 2.2);
      // Mesas
      d.scatter(0.22, 70, 51, 0.5, (x, r) => {
        const w = 18 + Math.round(r * 18);
        const h = 7 + Math.round(r * 7);
        d.rect(x, G - 6 - h, w, h + 6, '#c98a4b');
        d.rect(x, G - 6 - h, w, 1, '#dea566');
        d.rect(x + 2, G - 6 - h + 3, w - 4, 1, '#b97a3d');
      });
      d.ridge('#dca05a', 0.4, G - 3, 3, 5.3, 1.3);
      // Cacti
      d.scatter(0.7, 26, 61, 0.45, (x, r) => {
        const h = 5 + Math.round(r * 6);
        d.rect(x + 2, G - h, 2, h, '#3f8f4a');
        d.rect(x, G - h + 2, 1, 3, '#3f8f4a');
        d.rect(x, G - h + 4, 2, 1, '#3f8f4a');
        if (r > 0.4) { d.rect(x + 5, G - h + 1, 1, 3, '#3f8f4a'); d.rect(x + 4, G - h + 3, 2, 1, '#3f8f4a'); }
        d.rect(x + 2, G - h, 1, h, '#55a85f');
      });
      d.rect(0, G, W, H - G, '#e3b26b');
      d.rect(0, G, W, 1, '#f3cf8f');
      d.scatter(1, 9, 71, 0.4, (x, r) => d.rect(x, G + 2 + Math.round(r * 3), 1 + Math.round(r), 1, '#b9874a'));
    },
    particles: {
      rate: 14, max: 30, parallax: 1.2,
      spawn: (d, anywhere) => ({ x: anywhere ? rnd(0, d.W) : d.W + 2, y: rnd(d.G - 14, d.H - 1), vx: rnd(-40, -22), len: Math.random() > 0.6 ? 3 : 2 }),
      update: (q, s) => { q.x += q.vx * s; return q.x > -4; },
      draw: (q, d) => d.rect(q.x, q.y, q.len, 1, '#f9e2ad'),
    },
  },

  snowy: {
    draw(d) {
      const { W, H, G } = d;
      d.sky('#8fa9cc', '#e6effa');
      d.scatter(0.08, 34, 81, 0.9, (x, r) => d.peak(x, G - 4, 30 + r * 22, 14 + r * 10, '#7f95b5', '#f4f8fd', 0.35));
      d.ridge('#c9d6e6', 0.3, G - 4, 3, 3.3, 1.2);
      // Snowy pines
      d.scatter(0.55, 15, 91, 0.6, (x, r) => {
        const h = 9 + Math.round(r * 8);
        d.rect(x + 3, G - 3, 2, 3, '#4b3527');
        for (let k = 0; k < 3; k++) {
          const w = 8 - k * 2;
          const y = G - 3 - (k + 1) * (h / 3);
          d.rect(x + 4 - w / 2, y, w, h / 3 + 1, '#2e5a4f');
          d.rect(x + 4 - w / 2, y, w, 1, '#ffffff');
        }
      });
      d.rect(0, G, W, H - G, '#eef4fb');
      d.rect(0, G, W, 1, '#ffffff');
      d.rect(0, H - 2, W, 2, '#d3e0ee');
      d.scatter(1, 21, 101, 0.4, (x, r) => d.rect(x, G + 2 + Math.round(r * 2), 4 + Math.round(r * 4), 1, '#bfe3f5'));
    },
    particles: {
      rate: 26, max: 70, parallax: 0.6,
      spawn: (d, anywhere) => ({ x: rnd(0, d.W + 30), y: anywhere ? rnd(0, d.H) : -1, vy: rnd(5, 11), ph: rnd(0, 6), big: Math.random() > 0.8 }),
      update: (q, s, d) => { q.y += q.vy * s; q.x += Math.sin(d.t * 1.5 + q.ph) * 3 * s - 2 * s; return q.y < d.H && q.x > -3; },
      draw: (q, d) => d.rect(q.x, q.y, q.big ? 2 : 1, q.big ? 2 : 1, '#ffffff'),
    },
  },

  lava: {
    draw(d) {
      const { W, H, G } = d;
      d.sky('#1e0909', '#6e1f10');
      // Volcanoes with pulsing craters
      d.scatter(0.1, 60, 111, 0.7, (x, r, i) => {
        const w = 34 + r * 20;
        const h = 16 + r * 8;
        d.peak(x, G - 3, w, h, '#3a1512');
        const glow = mix('#b8320f', '#ffb02e', (Math.sin(d.t * 2 + i) + 1) / 2);
        d.rect(x - 2, G - 3 - h, 4, 2, glow);
        d.rect(x - 1, G - 3 - h - 1 - Math.round((Math.sin(d.t * 3 + i) + 1) * 1.5), 2, 1, '#ff7a2a');
      });
      // Rock spires
      d.scatter(0.38, 18, 121, 0.55, (x, r) => {
        const h = 5 + Math.round(r * 10);
        const w = 3 + Math.round(r * 3);
        d.rect(x, G - h, w, h, '#2b1513');
        d.rect(x + 1, G - h - 2, w - 2, 2, '#2b1513');
        d.rect(x, G - h, 1, h, '#41201b');
      });
      d.rect(0, G, W, H - G, '#2a1a18');
      d.rect(0, G, W, 1, '#4a2b25');
      // Glowing cracks
      d.scatter(1, 12, 131, 0.55, (x, r, i) => {
        const c = mix('#c73a0f', '#ffb02e', (Math.sin(d.t * 3 + i * 1.3) + 1) / 2);
        d.rect(x, G + 2 + Math.round(r * 2), 3 + Math.round(r * 4), 1, c);
      });
      d.rect(0, H - 1, W, 1, mix('#a8300c', '#ff6a00', (Math.sin(d.t * 1.7) + 1) / 2));
    },
    particles: {
      rate: 10, max: 26, parallax: 0.7,
      spawn: (d, anywhere) => ({ x: rnd(0, d.W + 20), y: anywhere ? rnd(0, d.H) : d.H, vy: rnd(-12, -6), life: rnd(2, 5) }),
      update: (q, s, d) => { q.y += q.vy * s; q.x += Math.sin(d.t * 4 + q.vy) * 2 * s; q.life -= s; return q.life > 0 && q.y > -2; },
      draw: (q, d) => d.rect(q.x, q.y, 1, 1, q.life > 1.5 ? '#ffb02e' : '#c73a0f'),
    },
  },

  night: {
    draw(d) {
      const { W, H, G } = d;
      d.sky('#070920', '#22245a');
      // Twinkling stars barely move: they're very far away.
      d.scatter(0.02, 4, 141, 0.35, (x, r, i) => {
        const y = Math.round(hash(i, 142) * (G - 14));
        const tw = (Math.sin(d.t * (1 + r * 2) + i) + 1) / 2;
        d.rect(x, y, 1, 1, mix('#3a3d7a', '#ffffff', tw));
      });
      d.disc(Math.round(W * 0.78), 9, 5, '#f4f1c9');
      d.rect(Math.round(W * 0.78) - 2, 7, 2, 2, '#d8d4a6');
      d.rect(Math.round(W * 0.78) + 1, 11, 1, 1, '#d8d4a6');
      d.ridge('#1b2246', 0.12, G - 10, 5, 6.2);
      // Round tree silhouettes
      d.scatter(0.45, 14, 151, 0.7, (x, r) => {
        const rad = 3 + Math.round(r * 3);
        d.rect(x + rad - 1, G - 4, 2, 4, '#0d1224');
        d.disc(x + rad, G - 4 - rad, rad, '#111a33');
      });
      d.rect(0, G, W, H - G, '#162238');
      d.rect(0, G, W, 1, '#26365a');
      d.scatter(1, 7, 161, 0.4, (x, r) => d.rect(x, G - 1, 1, 1 + Math.round(r), '#2b3d63'));
    },
    particles: {
      rate: 1.5, max: 12, parallax: 0.5,
      spawn: (d) => ({ x: rnd(0, d.W), y: rnd(d.G - 18, d.G - 2), ph: rnd(0, 6), life: rnd(5, 10) }),
      update: (q, s, d) => { q.x += Math.sin(d.t + q.ph) * 3 * s; q.y += Math.cos(d.t * 0.8 + q.ph) * 2 * s; q.life -= s; return q.life > 0 && q.x > -2; },
      draw: (q, d) => {
        const on = (Math.sin(d.t * 3 + q.ph) + 1) / 2;
        if (on > 0.3) d.rect(q.x, q.y, 1, 1, mix('#4a5a20', '#e6ff7a', on));
      },
    },
  },
};

// Still image of a map for the settings picker.
const thumbCache = {};
export function sceneThumb(id) {
  if (!thumbCache[id]) {
    const c = document.createElement('canvas');
    const scene = createScene(c, { width: 160, height: 46 });
    scene.setTheme(id);
    scene.jump(137);
    scene.render(16);
    thumbCache[id] = c.toDataURL();
  }
  return thumbCache[id];
}



