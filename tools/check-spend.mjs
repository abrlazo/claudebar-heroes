// Pure check of the lifetime spend rules (main/spend.js) and their formatting (renderer/lib/spend.ts).
// Usage: npm run check   (exit code 1 if anything fails)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { emptySpend, cleanSpend, addResult, usd } = require(path.join(root, 'src/main/spend.js'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-spend-'));
fs.writeFileSync(path.join(tmp, 'spend.mjs'), stripTypeScriptTypes(fs.readFileSync(path.join(root, 'src/renderer/lib/spend.ts'), 'utf8')));
const { formatUsd, formatDuration, spendLine, totalSpend } = await import(pathToFileURL(path.join(tmp, 'spend.mjs')).href);
fs.rmSync(tmp, { recursive: true, force: true });

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  spend: ${name}${detail ? `  (${detail})` : ''}`); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

for (const junk of ['x', 5, null, undefined, [], [1, 2], NaN, true, () => 1]) {
  check(`cleanSpend(${String(junk)}) is empty`, same(cleanSpend(junk), emptySpend()));
}
check('negative / NaN / string fields become 0', same(cleanSpend({ runs: -1, costMicro: NaN, durationMs: '5', turns: Infinity }), emptySpend()));
check('huge fields are capped', cleanSpend({ runs: 1e30, costMicro: 1e30 }).runs === 1e9 && cleanSpend({ costMicro: 1e30 }).costMicro === 1e12);
const proto = cleanSpend(JSON.parse('{"__proto__":{"runs":9},"runs":2}'));
check('__proto__ is ignored, own fields kept', proto.runs === 2 && !('9' in proto) && Object.keys(proto).length === 4);
check('unknown fields are dropped', same(Object.keys(cleanSpend({ runs: 1, prompt: 'secret', path: '/x' })), ['runs', 'costMicro', 'durationMs', 'turns']));

let s = addResult(emptySpend(), { costUsd: 0.5, durationMs: 2000, turns: 3, isError: false });
check('adds cost, time, turns and a run', same(s, { runs: 1, costMicro: 500000, durationMs: 2000, turns: 3 }));
s = addResult(s, { costUsd: 0.25, durationMs: 1000, turns: 1, isError: true });
check('an error result counts cost but not a run', s.runs === 1 && s.costMicro === 750000 && s.durationMs === 3000 && s.turns === 4);
check('bad values count as 0 (run still counts)', same(addResult(emptySpend(), { costUsd: -1, durationMs: NaN, turns: 'x' }), { runs: 1, costMicro: 0, durationMs: 0, turns: 0 }));
check('over the per-result caps counts as 0', same(addResult(emptySpend(), { costUsd: 1001, durationMs: 25 * 3600 * 1000, turns: 1e9 }), { runs: 1, costMicro: 0, durationMs: 0, turns: 0 }));
check('exactly at the caps is accepted', addResult(emptySpend(), { costUsd: 1000 }).costMicro === 1e9);
check('a non-object event changes nothing', same(addResult(s, null), s) && same(addResult(s, 'x'), s));
check('the input is not mutated', (() => { const a = emptySpend(); addResult(a, { costUsd: 1 }); return same(a, emptySpend()); })());
let t = emptySpend();
for (let i = 0; i < 1000; i++) { t = addResult(t, { costUsd: 0.1 }); t = addResult(t, { costUsd: 0.2 }); }
check('0.1 + 0.2 stays exact after 1000 additions', t.costMicro === 300000000 && usd(t) === 300);
let cap = { runs: 0, costMicro: 1e12 - 5, durationMs: 0, turns: 0 };
cap = addResult(cap, { costUsd: 1 });
check('the total cost is capped at $1,000,000', cap.costMicro === 1e12);

check('formatUsd 0', formatUsd(0) === '$0.0000');
check('formatUsd 0.00004', formatUsd(40) === '$0.0000', formatUsd(40));
check('formatUsd 0.5', formatUsd(500000) === '$0.5000');
check('formatUsd 12.3456', formatUsd(12345600) === '$12.35', formatUsd(12345600));
check('formatUsd 1e6', formatUsd(1e12) === '$1,000,000.00', formatUsd(1e12));
check('formatUsd junk', formatUsd(NaN) === '$0.0000' && formatUsd(-5) === '$0.0000');
check('formatDuration', formatDuration(0) === '0s' && formatDuration(59000) === '59s' && formatDuration(90000) === '1m 30s' && formatDuration(3600000) === '1h 0m' && formatDuration(4800000) === '1h 20m');
check('spendLine', spendLine({ runs: 1, costMicro: 500000, durationMs: 59000, turns: 1 }) === '$0.5000 · 1 run · 59s of Claude time', spendLine({ runs: 1, costMicro: 500000, durationMs: 59000, turns: 1 }));
check('spendLine of nothing', spendLine(undefined) === '$0.0000 · 0 runs · 0s of Claude time');
check('totalSpend sums and tolerates missing spend', same(totalSpend([{ spend: { runs: 1, costMicro: 5, durationMs: 7, turns: 2 } }, {}, { spend: { runs: 2, costMicro: 1, durationMs: 1, turns: 1 } }]), { runs: 3, costMicro: 6, durationMs: 8, turns: 3 }));

process.exit(failed ? 1 : 0);
