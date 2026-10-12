// Pure check for the hero sprite outline (engine/sprite.js `outlineInto`): the in-place version must match the old
// allocation-heavy algorithm byte for byte, and new outline pixels must not seed more outline.
// Usage: npm run check   (exit code 1 if anything fails)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-sprite-'));
const dir = path.join(root, 'src/renderer/engine');
for (const f of fs.readdirSync(dir)) if (f.endsWith('.js')) fs.copyFileSync(path.join(dir, f), path.join(tmp, f.replace(/\.js$/, '.mjs')));
// Imports inside the copies point at './x.js'; rewrite them to the .mjs copies.
for (const f of fs.readdirSync(tmp)) {
  const p = path.join(tmp, f);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/from '(\.\/[\w-]+)\.js'/g, "from '$1.mjs'"));
}
const { outlineInto } = await import(pathToFileURL(path.join(tmp, 'sprite.mjs')).href);
fs.rmSync(tmp, { recursive: true, force: true });

const OUTLINE = [20, 18, 31];
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  sprite: ${name}${detail ? `  (${detail})` : ''}`); };

// The previous implementation, kept inline as the reference.
function oldOutline(d, w, h) {
  const alpha = new Uint8Array(w * h);
  for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (alpha[i]) continue;
      const near = (x > 0 && alpha[i - 1]) || (x < w - 1 && alpha[i + 1]) || (y > 0 && alpha[i - w]) || (y < h - 1 && alpha[i + w]);
      if (near) d.set([...OUTLINE, 255], i * 4);
    }
  }
}

let seed = 12345;
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
function randomBuffer(w, h, density) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (rand() < density) { d[i * 4] = rand() * 256; d[i * 4 + 1] = rand() * 256; d[i * 4 + 2] = rand() * 256; d[i * 4 + 3] = 1 + rand() * 255; }
  }
  return d;
}
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

for (const [w, h] of [[32, 30], [1, 1], [3, 2], [7, 5]]) {
  let ok = true;
  for (const density of [0.02, 0.15, 0.5, 0.95]) {
    for (let n = 0; n < 5; n++) {
      const a = randomBuffer(w, h, density);
      const b = Uint8ClampedArray.from(a);
      oldOutline(a, w, h);
      outlineInto(b, w, h);
      if (!same(a, b)) ok = false;
    }
  }
  check(`matches the old algorithm on random ${w}x${h} buffers`, ok);
}

{
  const w = 7, h = 7;
  const d = new Uint8ClampedArray(w * h * 4);
  d[(3 * w + 3) * 4 + 3] = 255;
  outlineInto(d, w, h);
  let outlined = 0;
  for (let i = 0; i < w * h; i++) if (d[i * 4 + 3] === 255 && i !== 3 * w + 3) outlined++;
  check('a single opaque pixel gets exactly 4 outline neighbours', outlined === 4, `${outlined}`);
}

process.exit(failed ? 1 : 0);
