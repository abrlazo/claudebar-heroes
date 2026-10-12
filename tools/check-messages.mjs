// Pure check for the renderer's chat cap (lib/messages.ts): oldest dropped at 500, order kept, no mutation.
// The types are stripped with node:module (Node 22.13+). Usage: npm run check   (exit code 1 if anything fails)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-messages-'));
fs.writeFileSync(path.join(tmp, 'messages.mjs'), stripTypeScriptTypes(fs.readFileSync(path.join(root, 'src/renderer/lib/messages.ts'), 'utf8')));
const { MAX_MESSAGES, appendCapped } = await import(pathToFileURL(path.join(tmp, 'messages.mjs')).href);
fs.rmSync(tmp, { recursive: true, force: true });

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  messages: ${name}${detail ? `  (${detail})` : ''}`); };

// Must match MAX_MESSAGES in main/settings.js.
const mainSrc = fs.readFileSync(path.join(root, 'src/main/settings.js'), 'utf8');
const mainMax = Number(/const MAX_MESSAGES = (\d+)/.exec(mainSrc)?.[1]);
check('cap equals main/settings.js MAX_MESSAGES', MAX_MESSAGES === mainMax, `${MAX_MESSAGES} vs ${mainMax}`);

check('appends under the cap', appendCapped([1, 2], 3).join() === '1,2,3');
check('an undefined list works', appendCapped(undefined, 'a').join() === 'a');

const full = Array.from({ length: MAX_MESSAGES }, (_, i) => i);
const next = appendCapped(full, MAX_MESSAGES);
check('the 501st drops the oldest', next.length === MAX_MESSAGES && next[0] === 1 && next[next.length - 1] === MAX_MESSAGES, `${next.length}`);
check('order is kept', next.every((v, i) => i === 0 || v === next[i - 1] + 1));
check('exactly at the cap nothing is dropped', appendCapped(full.slice(1), 0).length === MAX_MESSAGES);

let threw = false;
try { appendCapped(Object.freeze([1, 2, 3]), 4); } catch { threw = true; }
check('does not mutate the input (frozen array)', !threw);
check('input unchanged', full.length === MAX_MESSAGES && full[0] === 0);
check('custom max', appendCapped([1, 2, 3], 4, 3).join() === '2,3,4');

process.exit(failed ? 1 : 0);
