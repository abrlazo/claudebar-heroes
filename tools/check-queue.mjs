// Pure check for the message queue rules (lib/queue.ts): FIFO, cap, removal, isolation, no mutation.
// The types are stripped with node:module (Node 22.13+), so the .ts file is tested as it is. Usage: npm run check   (exit code 1 if anything fails)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-queue-'));
fs.writeFileSync(path.join(tmp, 'queue.mjs'), stripTypeScriptTypes(fs.readFileSync(path.join(root, 'src/renderer/lib/queue.ts'), 'utf8')));
const { MAX_QUEUED, enqueue, removeItem, takeNext, clearQueue } = await import(pathToFileURL(path.join(tmp, 'queue.mjs')).href);
fs.rmSync(tmp, { recursive: true, force: true });

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  queue: ${name}${detail ? `  (${detail})` : ''}`); };
const texts = (q, ws) => (q[ws] ?? []).map((m) => m.text).join(',');

let q = {};
for (const t of ['a', 'b', 'c']) q = enqueue(q, 'w1', t, `id-${t}`).queues;
check('FIFO order', texts(q, 'w1') === 'a,b,c', texts(q, 'w1'));

const frozen = Object.freeze({ w1: Object.freeze([{ id: 'x', text: 'x' }]) });
let threw = false;
try { enqueue(frozen, 'w1', 'y', 'y'); removeItem(frozen, 'w1', 'x'); takeNext(frozen, 'w1'); clearQueue(frozen, 'w1'); } catch { threw = true; }
check('inputs are not mutated', !threw && texts(frozen, 'w1') === 'x');

let full = {};
let lastOk = true;
for (let i = 0; i < MAX_QUEUED + 1; i++) { const r = enqueue(full, 'w1', `m${i}`, `i${i}`); full = r.queues; lastOk = r.ok; }
check('cap', MAX_QUEUED === 5 && !lastOk && full.w1.length === MAX_QUEUED);

const blank = enqueue({}, 'w1', '   ', 'z');
check('blank ignored', !blank.ok && Object.keys(blank.queues).length === 0);

check('remove by id', texts(removeItem(q, 'w1', 'id-b'), 'w1') === 'a,c');
check('remove unknown id keeps state', removeItem(q, 'w1', 'nope') === q);

const t1 = takeNext(q, 'w1');
check('takeNext returns the head', t1.item?.text === 'a' && texts(t1.queues, 'w1') === 'b,c');
check('takeNext on empty', takeNext({}, 'w1').item === null);

let one = enqueue({}, 'w1', 'only', 'o').queues;
one = takeNext(one, 'w1').queues;
check('empty keys are dropped', !('w1' in one));

let two = enqueue(q, 'w2', 'other', 'o2').queues;
two = clearQueue(two, 'w1');
check('workspaces are isolated', !('w1' in two) && texts(two, 'w2') === 'other' && texts(removeItem(q, 'w2', 'id-a'), 'w1') === 'a,b,c');

if (failed) { console.log(`${failed} queue check(s) failed`); process.exit(1); }
