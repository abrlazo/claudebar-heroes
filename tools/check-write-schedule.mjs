// Pure check for the settings write schedule (main/write-schedule.js). Usage: npm run check   (exit code 1 if anything fails)

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { nextDelay, DEBOUNCE_MS, MAX_WAIT_MS } = createRequire(import.meta.url)(path.join(root, 'src/main/write-schedule.js'));

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  write-schedule: ${name}${detail ? `  (${detail})` : ''}`); };

const t = 1_000_000;
check('a fresh change waits the debounce', nextDelay(t, t) === 2000 && DEBOUNCE_MS === 2000);
check('close to the max wait the delay shrinks', nextDelay(t, t + 9000) === 1000);
check('at the max wait it writes now', nextDelay(t, t + 10000) === 0 && MAX_WAIT_MS === 10000);
check('past the max wait it is never negative', nextDelay(t, t + 20000) === 0);

process.exit(failed ? 1 : 0);
