// Pure check for the chat Markdown parser (lib/markdown.ts). Usage: npm run check   (exit code 1 if anything fails)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-md-'));
fs.writeFileSync(path.join(tmp, 'markdown.mjs'), stripTypeScriptTypes(fs.readFileSync(path.join(root, 'src/renderer/lib/markdown.ts'), 'utf8')));
const { parseMarkdown, parseInline, createStreamSplitter } = await import(pathToFileURL(path.join(tmp, 'markdown.mjs')).href);
fs.rmSync(tmp, { recursive: true, force: true });

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  markdown: ${name}${detail ? `  (${detail})` : ''}`); };
const plain = (nodes) => nodes.every((n) => n.t === 'text');
const J = (x) => JSON.stringify(x);

let n = parseInline('a **bold** b');
check('**bold**', n.some((x) => x.t === 'bold' && x.c[0].v === 'bold'), J(n));
n = parseInline('2 * 3 * 4');
check('2 * 3 * 4 stays literal', plain(n) && n.map((x) => x.v).join('') === '2 * 3 * 4', J(n));
n = parseInline('use snake_case_name here');
check('snake_case_name untouched', plain(n) && n.map((x) => x.v).join('') === 'use snake_case_name here', J(n));
n = parseInline('an *italic* and `code`');
check('italic and code', n.some((x) => x.t === 'em') && n.some((x) => x.t === 'code' && x.v === 'code'), J(n));
n = parseInline('open **bold never closed');
check('unclosed ** stays literal', plain(n) && n.map((x) => x.v).join('') === 'open **bold never closed', J(n));
n = parseInline('[go](https://x.test)');
check('link has no href, only text + url', n[0].t === 'link' && n[0].url === 'https://x.test' && !('href' in n[0]), J(n));

let b = parseMarkdown('```js\nconst a = 1;\n**not bold**');
check('unclosed fence is a code block', b.length === 1 && b[0].t === 'code' && b[0].lang === 'js' && b[0].v.includes('**not bold**'), J(b));
b = parseMarkdown('# Heading\ntext');
check('# heading', b[0].t === 'heading' && b[0].level === 1 && b[1].t === 'p', J(b));
b = parseMarkdown('###### deep');
check('deep heading clamps to 3', b[0].level === 3, J(b));
b = parseMarkdown('- a\n  - b\n- c');
check('nested list', b.length === 1 && b[0].t === 'ul' && b[0].items.length === 2 && b[0].items[0].sub?.items.length === 1, J(b));
b = parseMarkdown('1. one\n2. two');
check('ordered list', b[0].t === 'ol' && b[0].items.length === 2, J(b));
b = parseMarkdown('line one\nline two');
check('single newline kept as a break', b[0].t === 'p' && b[0].c.some((x) => x.t === 'br'), J(b));
check('empty string', parseMarkdown('').length === 0);
b = parseMarkdown('<script>alert(1)</script> <img onerror=x>');
check('HTML stays text', b[0].t === 'p' && plain(b[0].c) && b[0].c[0].v.startsWith('<script>'), J(b));

for (const [label, s] of [['a', 'a'.repeat(4000)], ['markers', '*_`~[**'.repeat(700)], ['stars', '* '.repeat(2000)], ['nest', '**_**_'.repeat(700)]]) {
  const t = Date.now();
  let ok = true;
  try { parseMarkdown(s); } catch { ok = false; }
  const ms = Date.now() - t;
  check(`4000+ char input "${label}" finishes`, ok && ms < 500, `${ms} ms`);
}
// Streaming: the settled prefix parsed once plus the tail must equal parsing the whole text, at every length.
const streamDocs = {
  mixed: '# Title\n\nSome **bold** text\nand more.\n\n- a\n- b\n  - c\n\n```js\nconst x = 1;\n\nconst y = 2;\n```\n\n> quote\n> more\n\n---\n\n1. one\n2. two\n\nend *em*',
  unclosedFence: 'intro\n\n```\ncode\n\nstill code\n',
  fenceInParagraph: 'text\n```\n\nin fence\n```\nafter\n\nlast',
  crlf: 'a\r\n\r\nb\r\n```\r\n\r\n```\r\n\r\nc',
  blanks: '\n\n\nx\n\n\n\ny\n',
};
for (const [label, doc] of Object.entries(streamDocs)) {
  const split = createStreamSplitter();
  let bad = -1;
  for (let len = 0; len <= doc.length && bad < 0; len++) {
    const text = doc.slice(0, len);
    const cut = split(text);
    if (J([...parseMarkdown(text.slice(0, cut)), ...parseMarkdown(text.slice(cut))]) !== J(parseMarkdown(text))) bad = len;
  }
  check(`stream split "${label}" parses like the whole text at every length`, bad < 0, bad < 0 ? '' : `differs at ${bad}`);
}
{
  const split = createStreamSplitter();
  split('a\n\nb');
  check('stream split starts over on a new text', split('xyz') === 0);
  check('stream split finds the cut again after a reset', split('xyz\n\nq') === 5);
}

process.exit(failed ? 1 : 0);
