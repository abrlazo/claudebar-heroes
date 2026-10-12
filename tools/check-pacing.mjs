// Pure check for the battle loop pacing (engine/pacing.js): the frame cap must land on every 2nd frame at 60 Hz,
// stay near 30 / 12 frames per second at other refresh rates, and never lose time to the dt clamp.
// Usage: npm run check   (exit code 1 if anything fails)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-pacing-'));
fs.copyFileSync(path.join(root, 'src/renderer/engine/pacing.js'), path.join(tmp, 'pacing.mjs'));
const { frameInterval, frameDue, clampDt, AWAKE_FRAME_MS, IDLE_FRAME_MS } = await import(pathToFileURL(path.join(tmp, 'pacing.mjs')).href);
fs.rmSync(tmp, { recursive: true, force: true });

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  pacing: ${name}${detail ? `  (${detail})` : ''}`); };

// Simulates a display refreshing every `step` ms for `frames` frames; returns how many frames were drawn.
function drawn(step, frames, interval) {
  let last = 0;
  let n = 0;
  for (let i = 1; i <= frames; i++) {
    const now = i * step;
    if (frameDue(now, last, interval)) { last = now; n++; }
  }
  return n;
}

const at60 = drawn(1000 / 60, 600, AWAKE_FRAME_MS);
check('60 Hz awake draws every 2nd frame', Math.abs(at60 - 300) <= 1, `${at60} of 600`);
const at144 = drawn(1000 / 144, 144, AWAKE_FRAME_MS);
check('144 Hz awake is about 30 per second', at144 >= 28 && at144 <= 32, `${at144}`);
const idle60 = drawn(1000 / 60, 600, IDLE_FRAME_MS);
check('60 Hz idle is about 12 per second', idle60 >= 110 && idle60 <= 130, `${idle60} in 10 s`);
check('busy is faster than idle', frameInterval(true) < frameInterval(false));
check('clampDt caps a long gap', clampDt(1000, 0) === 100);
check('clampDt keeps a short one', clampDt(10, 0) === 10);
check('idle interval stays under the dt clamp', IDLE_FRAME_MS < 100, `${IDLE_FRAME_MS.toFixed(1)} ms`);

process.exit(failed ? 1 : 0);
