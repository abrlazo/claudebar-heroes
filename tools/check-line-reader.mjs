// Pure check for the stdout line splitter (main/line-reader.js). Usage: npm run check   (exit code 1 if anything fails)
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createLineReader } = require('../src/main/line-reader.js');

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  line-reader: ${name}${detail ? `  (${detail})` : ''}`); };

const collect = (chunks) => {
  const out = [];
  const r = createLineReader((l) => out.push(l));
  for (const c of chunks) r.push(c);
  return out;
};

check('one chunk, several lines', collect(['a\nb\nc\n']).join('|') === 'a|b|c');
check('a line split across chunks', collect(['{"x":', '1}\n']).join('|') === '{"x":1}');
check('incomplete last line waits', collect(['a\nb']).join('|') === 'a');
check('it arrives with the next chunk', collect(['a\nb', 'c\n']).join('|') === 'a|bc');
check('blank and whitespace lines are skipped, lines trimmed', collect(['\n  \n x \r\n']).join('|') === 'x');
check('newline as its own chunk', collect(['abc', '\n', 'def', '\n']).join('|') === 'abc|def');

// Every split point of a sample gives the same lines.
const sample = '{"a":1}\n\n{"b":"é ✓ 🙂"}\r\nplain\n{"c":3}\n';
const whole = collect([sample]).join('|');
let same = true;
for (let i = 0; i <= sample.length; i++) {
  for (let j = i; j <= sample.length; j += 3) {
    if (collect([sample.slice(0, i), sample.slice(i, j), sample.slice(j)]).join('|') !== whole) same = false;
  }
}
check('any chunking gives the same lines', same);

// A long line in many chunks is not rescanned from its start each time (linear, not quadratic).
const big = 'x'.repeat(4_000_000);
const t = Date.now();
const got = [];
const r = createLineReader((l) => got.push(l.length));
for (let i = 0; i < big.length; i += 16_384) r.push(big.slice(i, i + 16_384));
r.push('\n');
const ms = Date.now() - t;
check('a 4 MB line in 16 KB chunks', got.length === 1 && got[0] === big.length && ms < 1500, `${ms} ms`);

process.exit(failed ? 1 : 0);
