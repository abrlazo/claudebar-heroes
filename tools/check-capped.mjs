// Pure check for the capped text buffer (main/capped-text.js) used for Claude's stderr. Usage: npm run check   (exit code 1 if anything fails)

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { createCapped } = createRequire(import.meta.url)(path.join(root, 'src/main/capped-text.js'));

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  capped: ${name}${detail ? `  (${detail})` : ''}`); };

{
  const c = createCapped();
  c.add('error: one\n');
  c.add('error: two\n');
  check('under the cap the text is the input', c.text() === 'error: one\nerror: two\n');
}
{
  const c = createCapped();
  const marker = '\n[... earlier output omitted ...]\n';
  const head = 'unknown option --permission-prompt-tool\n';
  c.add(head);
  const filler = 'x'.repeat(1000) + '\n';
  for (let i = 0; i < 1024; i++) c.add(filler); // about 1 MB
  const tail = 'LAST LINE: fatal\n';
  c.add(tail);
  const text = c.text();
  check('1 MB of input stays bounded', text.length <= 16384 + 49152 + marker.length, `${text.length}`);
  check('the first 100 characters survive', text.startsWith(head.padEnd(100, 'x').slice(0, 40)) && text.slice(0, 100) === (head + filler).slice(0, 100));
  check('the last 100 characters survive', text.slice(-100) === (filler + tail).slice(-100));
  check('"unknown option" in the first line survives', /unknown option/.test(text.split('\n')[0]));
  check('the omission is marked', text.includes(marker.trim()));
}
{
  // The head fills in the middle of a chunk: nothing may be lost between head and tail.
  const c = createCapped(10, 20);
  c.add('0123456');
  c.add('789ABCDEF');
  c.add('GHIJ');
  check('a chunk that straddles the head loses nothing', c.text() === '0123456789ABCDEFGHIJ', c.text());
}
{
  const c = createCapped(4, 4);
  c.add('abcdefgh');
  c.add('ijkl');
  check('a small cap keeps head and tail with a marker', c.text() === 'abcd\n[... earlier output omitted ...]\nijkl', JSON.stringify(c.text()));
}

process.exit(failed ? 1 : 0);
