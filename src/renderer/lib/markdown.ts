// Tiny pure Markdown parser for assistant chat text. It only returns data (no HTML): the renderer maps it to React elements,
// so chat text can never inject markup or links. Unmatched markers stay literal; it never throws.

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'br' }
  | { t: 'bold' | 'em' | 'del'; c: Inline[] }
  | { t: 'link'; c: Inline[]; url: string };

export interface ListItem { c: Inline[]; sub: ListBlock | null }
export interface ListBlock { t: 'ul' | 'ol'; items: ListItem[] }
export type Block =
  | { t: 'heading'; level: 1 | 2 | 3; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; c: Inline[] }
  | { t: 'hr' }
  | { t: 'p'; c: Inline[] }
  | ListBlock;

const MAX_DEPTH = 4;
const isSpace = (ch: string | undefined): boolean => ch === undefined || /\s/.test(ch);
const isWord = (ch: string | undefined): boolean => ch !== undefined && /[A-Za-z0-9]/.test(ch);

/** Index of the closing single `*` / `_` for an opener at `i`, or -1. */
function findSingleCloser(s: string, i: number, m: string): number {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] !== m) continue;
    if (s[j + 1] === m) { j++; continue; } // a `**` pair inside is not our closer
    if (isSpace(s[j - 1])) continue;
    if (m === '_' && isWord(s[j + 1])) continue;
    return j;
  }
  return -1;
}

export function parseInline(s: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const two = s.slice(i, i + 2);
    if (ch === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1) { flush(); out.push({ t: 'code', v: s.slice(i + 1, j) }); i = j + 1; continue; }
    } else if (depth < MAX_DEPTH && (two === '**' || two === '__' || two === '~~')) {
      const j = s.indexOf(two, i + 2);
      const ok = j > i + 2 && !isSpace(s[i + 2]) && !isSpace(s[j - 1]) && !(two === '__' && (isWord(s[i - 1]) || isWord(s[j + 2])));
      if (ok) {
        flush();
        out.push({ t: two === '~~' ? 'del' : 'bold', c: parseInline(s.slice(i + 2, j), depth + 1) });
        i = j + 2;
        continue;
      }
    } else if (depth < MAX_DEPTH && (ch === '*' || ch === '_') && s[i + 1] !== ch && !isSpace(s[i + 1]) && !(ch === '_' && isWord(s[i - 1]))) {
      const j = findSingleCloser(s, i, ch);
      if (j > i + 1) { flush(); out.push({ t: 'em', c: parseInline(s.slice(i + 1, j), depth + 1) }); i = j + 1; continue; }
    } else if (depth < MAX_DEPTH && ch === '[') {
      const close = s.indexOf('](', i + 1);
      const end = close > i ? s.indexOf(')', close + 2) : -1;
      if (close > i + 1 && end > close + 2 && !s.slice(i + 1, close).includes('[')) {
        flush();
        out.push({ t: 'link', c: parseInline(s.slice(i + 1, close), depth + 1), url: s.slice(close + 2, end) });
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const FENCE = /^\s*```\s*([\w+#.-]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

const startsBlock = (line: string): boolean =>
  FENCE.test(line) || HEADING.test(line) || HR.test(line) || ITEM.test(line) || QUOTE.test(line);

function joinLines(lines: string[]): Inline[] {
  const out: Inline[] = [];
  lines.forEach((l, k) => {
    if (k > 0) out.push({ t: 'br' });
    out.push(...parseInline(l));
  });
  return out;
}

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // the closing fence; an unclosed one (streaming) simply runs to the end
      blocks.push({ t: 'code', lang: fence[1], v: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ t: 'heading', level: Math.min(3, heading[1].length) as 1 | 2 | 3, c: parseInline(heading[2]) });
      i++;
      continue;
    }
    if (HR.test(line)) { blocks.push({ t: 'hr' }); i++; continue; }

    if (QUOTE.test(line)) {
      const q: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) q.push(QUOTE.exec(lines[i])![1]), i++;
      blocks.push({ t: 'quote', c: joinLines(q) });
      continue;
    }

    if (ITEM.test(line)) {
      const top: ListBlock = { t: ITEM.exec(line)![2].match(/^\d/) ? 'ol' : 'ul', items: [] };
      while (i < lines.length && ITEM.test(lines[i]) && !HR.test(lines[i])) {
        const m = ITEM.exec(lines[i])!;
        const item: ListItem = { c: parseInline(m[3]), sub: null };
        const ordered = /^\d/.test(m[2]);
        if (m[1].length >= 2 && top.items.length) {
          const parent = top.items[top.items.length - 1];
          if (!parent.sub) parent.sub = { t: ordered ? 'ol' : 'ul', items: [] };
          parent.sub.items.push(item);
        } else {
          top.items.push(item);
        }
        i++;
      }
      blocks.push(top);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && (para.length === 0 || !startsBlock(lines[i]))) para.push(lines[i++]);
    blocks.push({ t: 'p', c: joinLines(para) });
  }
  return blocks;
}

const FENCE_CLOSE = /^\s*```\s*$/;

/**
 * For text that only grows (a streaming answer): returns where the "settled" part ends, i.e. just after the
 * last blank line that is outside a code fence. Every block ends at such a line, so
 * `parseMarkdown(text)` equals `parseMarkdown(text.slice(0, cut))` followed by `parseMarkdown(text.slice(cut))`,
 * and the settled part can be parsed once instead of every frame. Each call only scans the lines that arrived
 * since the last one; text that does not continue the previous one starts over.
 */
export function createStreamSplitter(): (text: string) => number {
  let seen = '';     // the text scanned so far (up to `scanned`)
  let scanned = 0;   // start of the first line not scanned yet (always just after a '\n')
  let inFence = false;
  let cut = 0;
  return (text: string): number => {
    if (text.length < scanned || !text.startsWith(seen)) { scanned = 0; inFence = false; cut = 0; }
    let nl: number;
    while ((nl = text.indexOf('\n', scanned)) !== -1) {
      const line = text.slice(scanned, nl);
      if (inFence) { if (FENCE_CLOSE.test(line)) inFence = false; }
      else if (FENCE.test(line)) inFence = true;
      else if (!line.trim()) cut = nl + 1;
      scanned = nl + 1;
    }
    seen = text.slice(0, scanned);
    return cut;
  };
}
