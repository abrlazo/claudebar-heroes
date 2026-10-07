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

const BODY_W = 9;
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  aura: ${name}${detail ? `  (${detail})` : ''}`); };

// A recording stub. Triangle vertices (moveTo/lineTo) that get filled are flames, ones that get stroked are bolts;
// 1px-wide fillRects are sparks; ellipse() radii are the burst.
const flameXs = []; const boltXs = []; const sparkXs = [];
let burstRx = 0;
let verts = [];
const ctx = {
  clearRect() {},
  fillRect(x, _y, w) { if (w === 1) sparkXs.push(x, x + 1); },
  beginPath() { verts = []; }, closePath() {},
  moveTo(x) { verts.push(x); }, lineTo(x) { verts.push(x); },
  fill() { flameXs.push(...verts); }, stroke() { boltXs.push(...verts); },
  ellipse(_x, _y, rx) { burstRx = Math.max(burstRx, rx); },
  createRadialGradient() { return { addColorStop() {} }; },
  lineWidth: 1, fillStyle: '', strokeStyle: '', lineJoin: '',
};
const canvas = { width: 0, height: 0, getContext: () => ctx };
const aura = createAura(canvas);
const CX = 15.5; // body centre; see aura.js

aura.setColor('#ffd23f');
aura.setLightning(true);
for (const active of [false, true]) {
  aura.setActive(active);
  for (let i = 0; i < 700; i++) aura.update(16);
}
aura.burst();
for (let i = 0; i < 80; i++) aura.update(16);

const reach = (xs) => (xs.length ? Math.max(...xs.map((x) => Math.abs(x - CX))) : 0);
const flameReach = reach(flameXs);
const boltReach = reach(boltXs);
const sparkReach = reach(sparkXs);

check('canvas is no wider than 3.5x the body', canvas.width <= 3.5 * BODY_W, `${canvas.width}px`);
check('flames are at most 1.8x the body wide', flameXs.length > 0 && flameReach * 2 <= 1.8 * BODY_W, `${(flameReach * 2).toFixed(1)}px`);
check('sparks stay within 1.8x the body', sparkXs.length > 0 && sparkReach * 2 <= 1.8 * BODY_W, `${(sparkReach * 2).toFixed(1)}px`);
check('lightning is drawn and stays within +-10 of the centre', boltXs.length > 0 && boltReach <= 10, `${boltReach.toFixed(2)}px`);
check('the burst ring is at most 2.4x the body wide', burstRx > 0 && burstRx * 2 <= 2.4 * BODY_W, `${(burstRx * 2).toFixed(1)}px`);
check('everything fits inside the canvas', Math.max(flameReach, boltReach, sparkReach, burstRx) + 1 <= Math.min(CX, canvas.width - CX));

if (failed) { console.log(`\n${failed} aura check(s) failed`); process.exit(1); }
