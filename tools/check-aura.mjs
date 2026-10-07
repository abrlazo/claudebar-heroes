// Pure check for the level aura (engine/aura.js): it must hug the hero's body. Drives the aura with a stub
// 2D context and measures, in aura-canvas px, how far flames, sparks, lightning and the burst reach.
// Usage: npm run check   (exit code 1 if anything fails)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-aura-'));
fs.copyFileSync(path.join(root, 'src/renderer/engine/aura.js'), path.join(tmp, 'aura.mjs'));
const { createAura } = await import(pathToFileURL(path.join(tmp, 'aura.mjs')).href);
fs.rmSync(tmp, { recursive: true, force: true });

// Body footprints in aura-canvas px (mirror STAND / LIE in aura.js): the standing body and the lying one.
const STAND = { len: 9, cx: 15.5 };
const LIE = { len: 20, cx: 19 };
const BASE = 51; // ground
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  aura: ${name}${detail ? `  (${detail})` : ''}`); };

// A recording stub. Triangle vertices (moveTo/lineTo) that get filled are flames, ones that get stroked are bolts;
// 1px-wide fillRects are sparks; ellipse() radii are the burst. Positions are recorded as [x, y] pairs.
function record(lying) {
  const r = { flame: [], bolt: [], spark: [], burstRx: 0, burstRy: 0, burstCx: 0, burstCy: 0, canvas: null, snapshots: [] };
  let verts = [];
  const ctx = {
    clearRect() {},
    fillRect(x, y, w, h) { if (w === 1) r.spark.push([x, y + h], [x + 1, y]); },
    beginPath() { verts = []; }, closePath() {},
    moveTo(x, y) { verts.push([x, y]); }, lineTo(x, y) { verts.push([x, y]); },
    fill() { r.flame.push(...verts); }, stroke() { r.bolt.push(...verts); },
    ellipse(x, y, rx, ry) { if (rx > r.burstRx) { r.burstRx = rx; r.burstRy = ry; r.burstCx = x; r.burstCy = y; } },
    createRadialGradient() { return { addColorStop() {} }; },
    lineWidth: 1, fillStyle: '', strokeStyle: '', lineJoin: '',
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx };
  r.canvas = canvas;
  const aura = createAura(canvas);
  aura.setColor('#ffd23f');
  aura.setLightning(true);
  if (lying) {
    // The aura lies down with the hero: glide, then run it in the lying pose (asleep: low power, no lightning).
    aura.setActive(false);
    aura.setLying(true);
    for (let i = 0; i < 700; i++) aura.update(16);
    r.glided = true;
  } else {
    for (const active of [false, true]) {
      aura.setActive(active);
      for (let i = 0; i < 700; i++) aura.update(16);
    }
  }
  r.aura = aura;
  // Clear what was recorded while settling, then measure a fresh stretch (plus a burst).
  for (const k of ['flame', 'bolt', 'spark']) r[k].length = 0;
  r.burstRx = 0;
  aura.burst();
  for (let i = 0; i < 80; i++) aura.update(16);
  return r;
}

const reach = (pts, cx) => (pts.length ? Math.max(...pts.map(([x]) => Math.abs(x - cx))) : 0);
const meanX = (pts) => pts.reduce((a, [x]) => a + x, 0) / pts.length;
const maxY = (pts) => Math.max(...pts.map(([, y]) => y));

// ----- standing (awake) -----
{
  const r = record(false);
  const { len, cx } = STAND;
  const flameReach = reach(r.flame, cx); const boltReach = reach(r.bolt, cx); const sparkReach = reach(r.spark, cx);
  check('canvas is no wider than 3.5x the widest body and at most 40px', r.canvas.width <= 3.5 * Math.max(STAND.len, LIE.len) && r.canvas.width <= 40, `${r.canvas.width}px`);
  check('flames are at most 2.1x the body wide', r.flame.length > 0 && flameReach * 2 <= 2.1 * len, `${(flameReach * 2).toFixed(1)}px`);
  check('sparks stay within 1.8x the body', r.spark.length > 0 && sparkReach * 2 <= 1.8 * len, `${(sparkReach * 2).toFixed(1)}px`);
  check('lightning is drawn and stays within +-10 of the centre', r.bolt.length > 0 && boltReach <= 10, `${boltReach.toFixed(2)}px`);
  check('the burst ring is at most 2.4x the body wide', r.burstRx > 0 && r.burstRx * 2 <= 2.4 * len, `${(r.burstRx * 2).toFixed(1)}px`);
  check('everything fits inside the canvas', Math.max(flameReach, boltReach, sparkReach, r.burstRx) + 1 <= Math.min(cx, r.canvas.width - cx));
}

// ----- lying (asleep) -----
{
  const r = record(true);
  const { len, cx } = LIE;
  const W = r.canvas.width;
  const inside = (pts) => pts.every(([x]) => x >= 1 && x <= W - 1);
  const flameReach = reach(r.flame, cx); const sparkReach = reach(r.spark, cx);
  check('lying: flames are drawn, centred on the lying body and at most 1.8x its length', r.flame.length > 0 && Math.abs(meanX(r.flame) - cx) <= 1 && flameReach * 2 <= 1.8 * len, `mean ${meanX(r.flame).toFixed(1)}, ${(flameReach * 2).toFixed(1)}px`);
  check('lying: flames and sparks stay inside the canvas (1px margin)', inside(r.flame) && inside(r.spark), `${W}px`);
  check('lying: sparks stay within 1.8x the body length', r.spark.length > 0 && sparkReach * 2 <= 1.8 * len, `${(sparkReach * 2).toFixed(1)}px`);
  check('lying: nothing is drawn below the ground', maxY(r.flame) <= BASE + 0.01 && maxY(r.spark) <= BASE + 1, `${maxY(r.flame).toFixed(1)}, ${maxY(r.spark).toFixed(1)}`);
  check('lying: asleep, no lightning', r.bolt.length === 0);
  check('lying: the burst ring is centred on the body, at most 2.4x its length, and fits the canvas', r.burstRx > 0 && r.burstRx * 2 <= 2.4 * len && Math.abs(r.burstCx - cx) <= 1 && r.burstCx - r.burstRx >= 0 && r.burstCx + r.burstRx <= W, `rx ${r.burstRx.toFixed(1)}`);

  // Waking: the aura glides back to the standing footprint (no jump) and ends exactly there.
  r.flame.length = 0;
  r.aura.setActive(true);
  r.aura.setLying(false);
  const means = [];
  for (let i = 0; i < 120; i++) { r.aura.update(16); means.push(meanX(r.flame.splice(0))); }
  const steps = means.slice(1).map((m, i) => Math.abs(m - means[i]));
  check('waking: the flames glide from the lying to the standing body (no jump), ending on it', Math.max(...steps) < 3 && Math.abs(means[means.length - 1] - STAND.cx) <= 0.5, `end ${means[means.length - 1].toFixed(2)}, max step ${Math.max(...steps).toFixed(2)}`);
}

if (failed) { console.log(`\n${failed} aura check(s) failed`); process.exit(1); }
