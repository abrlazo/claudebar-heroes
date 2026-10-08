// Pure checks for the agent archive (main/archive.js: clamping and validation) and the idle rules
// (renderer/lib/idle.ts). Usage: npm run check   (exit code 1 if anything fails)

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archive = createRequire(import.meta.url)(path.join(root, 'src/main/archive.js'));
const { cleanArchived, cleanArchive, MAX_ARCHIVED, MAX_ARCHIVE_MESSAGES, MAX_MESSAGE_CHARS, MAX_CHAT_CHARS } = archive;

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const base = (over = {}) => ({
  id: 'a1', name: 'alpha', definition: 'alpha', task: 'do it', observed: false, status: 'done', reason: 'idle',
  startedAt: 1000, endedAt: 2000, archivedAt: 3000, usage: { input: 1, output: 2, cacheRead: 3, cacheCreate: 4 },
  sessionId: 'sess', messages: [{ kind: 'user', text: 'do it' }, { kind: 'assistant', text: 'ok' }], ...over,
});
const textSize = (m) => (m.kind === 'tool' ? m.name.length + (m.summary?.length ?? 0) : m.text.length);
const chars = (r) => r.messages.reduce((n, m) => n + textSize(m), 0);

// ----- shape and validation -----
const ok = cleanArchived(base());
check('a good record passes unchanged', ok && ok.id === 'a1' && ok.status === 'done' && ok.reason === 'idle' && ok.usage.cacheCreate === 4 && ok.messages.length === 2 && ok.sessionId === 'sess');
check('extra and unknown properties are dropped (new object, no spreading)', (() => {
  const r = cleanArchived(base({ evil: { x: 1 }, __proto__: { polluted: true }, constructor: 'x', messages: [{ kind: 'user', text: 'hi', extra: 1 }] }));
  return r && !('evil' in r) && !('polluted' in r) && Object.keys(r.messages[0]).sort().join() === 'kind,text' && ({}).polluted === undefined;
})());
check('JSON with __proto__ / constructor keys cannot add fields', (() => {
  const r = cleanArchived(JSON.parse('{"id":"b","status":"done","reason":"idle","__proto__":{"admin":true},"constructor":{"x":1},"messages":[{"kind":"user","text":"t","__proto__":{"y":1}}]}'));
  return r && r.admin === undefined && ({}).admin === undefined && !Object.prototype.hasOwnProperty.call(r, 'constructor');
})());
check('a record without a plain string id is refused', [undefined, 5, '', 'a b', 'x'.repeat(101), '../x', null, [], 'a/b'].every((id) => cleanArchived(base({ id })) === null));
check('not an object is refused', [null, undefined, 'x', 5, []].every((v) => cleanArchived(v) === null));
check('a wrong status or reason is refused', cleanArchived(base({ status: 'running' })) === null && cleanArchived(base({ reason: 'x' })) === null && cleanArchived(base({ status: {} })) === null);
check('negative, NaN, infinite and huge numbers are cleaned', (() => {
  const r = cleanArchived(base({ startedAt: -5, endedAt: NaN, usage: { input: -1, output: Infinity, cacheRead: 1e30, cacheCreate: '5' } }));
  return r.startedAt === 0 && r.endedAt === null && r.usage.input === 0 && r.usage.output === 0 && r.usage.cacheRead === 1e12 && r.usage.cacheCreate === 0;
})());
check('names and task are clamped (40 / 60 / 500)', (() => {
  const r = cleanArchived(base({ name: 'n'.repeat(99), definition: 'd'.repeat(99), task: 't'.repeat(900), sessionId: 's'.repeat(500) }));
  return r.name.length === 40 && r.definition.length === 60 && r.task.length === 500 && r.sessionId.length === 100;
})());
check('non-string fields do not crash and become empty', (() => {
  const r = cleanArchived(base({ name: { a: 1 }, task: 7, messages: 'nope', usage: 'x', sessionId: 5 }));
  return r && r.name === '' && r.task === '' && r.messages.length === 0 && r.usage.input === 0 && r.sessionId === null;
})());
check('unknown message kinds and non-objects are dropped', cleanArchived(base({ messages: [{ kind: 'system', text: 'x' }, 'str', null, { kind: 'user', text: 'ok' }, { kind: 'tool', name: 'Read', summary: 's' }] })).messages.length === 2);
check('tool messages keep name <= 80 and summary <= 300', (() => {
  const m = cleanArchived(base({ messages: [{ kind: 'tool', name: 'n'.repeat(200), summary: 's'.repeat(900) }] })).messages[0];
  return m.name.length === 80 && m.summary.length === 300;
})());

// ----- caps -----
check('a 5000-char message is cut to 4000', cleanArchived(base({ messages: [{ kind: 'assistant', text: 'x'.repeat(5000) }] })).messages[0].text.length === MAX_MESSAGE_CHARS);
{
  const many = [{ kind: 'user', text: 'THE TASK' }, ...Array.from({ length: 1999 }, (_, i) => ({ kind: 'assistant', text: `m${i}` }))];
  const r = cleanArchived(base({ messages: many }));
  check('2000 messages are cut to the count cap', r.messages.length <= MAX_ARCHIVE_MESSAGES, `${r.messages.length}`);
  check('...the task (first message) survives, then an "omitted" line, then the newest', r.messages[0].text === 'THE TASK' && r.messages[1].kind === 'meta' && /earlier messages? omitted/.test(r.messages[1].text) && r.messages.at(-1).text === 'm1998', `${r.messages[1].text}`);
  check('...the omitted count is right', r.messages[1].text === `${2000 - 1 - (r.messages.length - 2)} earlier messages omitted`, r.messages[1].text);
}
{
  const big = Array.from({ length: 100 }, () => ({ kind: 'assistant', text: 'y'.repeat(4000) }));
  const r = cleanArchived(base({ messages: [{ kind: 'user', text: 'task' }, ...big] }));
  check('100 KB+ of text is cut to the chat size cap', chars(r) <= MAX_CHAT_CHARS, `${chars(r)} chars`);
  check('...and keeps the task and the newest message', r.messages[0].text === 'task' && r.messages.at(-1).text.length === 4000);
}
check('a chat under the caps is kept whole, with no "omitted" line', (() => {
  const r = cleanArchived(base({ messages: Array.from({ length: 150 }, (_, i) => ({ kind: 'user', text: `m${i}` })) }));
  return r.messages.length === 150 && !r.messages.some((m) => m.kind === 'meta');
})());
check('cleaning is idempotent (a stored chat reloads the same)', (() => {
  const once = cleanArchived(base({ messages: [{ kind: 'user', text: 't' }, ...Array.from({ length: 500 }, (_, i) => ({ kind: 'assistant', text: `m${i}` }))] }));
  return JSON.stringify(cleanArchived(once)) === JSON.stringify(once);
})());
{
  const list = Array.from({ length: 25 }, (_, i) => base({ id: `c${i}` }));
  const r = cleanArchive(list);
  check('25 records are trimmed to 20, oldest first', r.length === MAX_ARCHIVED && r[0].id === 'c5' && r.at(-1).id === 'c24', `${r.length} ${r[0]?.id}..${r.at(-1)?.id}`);
  const d = cleanArchive([base({ id: 'x', task: 'old' }), base({ id: 'y' }), base({ id: 'x', task: 'new' })]);
  check('the same id is kept once (the newest), moved to the end', d.length === 2 && d[1].id === 'x' && d[1].task === 'new');
  check('a stored list that is not an array, or has junk, loads clean', cleanArchive('x').length === 0 && cleanArchive({}).length === 0 && cleanArchive([null, 5, base()]).length === 1);
  check('a hostile list is bounded work and size (10 000 records, 20 kept)', cleanArchive(Array.from({ length: 10000 }, (_, i) => base({ id: `h${i}` }))).length === MAX_ARCHIVED);
}

// ----- the renderer's mirror of the limits -----
const agentsTs = fs.readFileSync(path.join(root, 'src/renderer/lib/agents.ts'), 'utf8');
check('IDLE_RETIRE_MS is 2 minutes in lib/agents.ts', /export const IDLE_RETIRE_MS = 2 \* 60 \* 1000;/.test(agentsTs));
check('the idle seam is renderer-only: main and preload never mention it', !/__cbhIdleMs/.test(fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8') + fs.readFileSync(path.join(root, 'src/main/preload.js'), 'utf8') + fs.readFileSync(path.join(root, 'src/main/settings.js'), 'utf8')));
const mainJs = fs.readFileSync(path.join(root, 'src/main/main.js'), 'utf8');
check('settings:set drops the archive and settings:update does not allow it', /settings:set[\s\S]{0,400}archive/.test(mainJs) && !/allowed\.archive/.test(mainJs));
check('the ArchiveDrawer empty text matches the idle time (2 minutes)', /after 2 minutes idle/.test(fs.readFileSync(path.join(root, 'src/renderer/components/panel/ArchiveDrawer.tsx'), 'utf8')));

// ----- idle rules (TypeScript run directly by Node) -----
const idle = await import(pathToFileURL(path.join(root, 'src/renderer/lib/idle.ts')).href);
const L = 120000;
const ag = (id, status, last, dying = false) => ({ id, status, dying, lastActivityAt: last });
check('idle: a finished agent counts down from its last activity', idle.idleState(ag('a', 'done', 1000), 31000, L, null).leftMs === L - 30000);
check('idle: the selected agent is held (no countdown, never due)', idle.idleState(ag('a', 'done', 0), 999999, L, 'a').kind === 'none' && idle.dueAgents([ag('a', 'done', 0)], 999999, L, 'a').length === 0);
check('idle: a running agent is never due, and is "quiet" only after the limit', idle.dueAgents([ag('r', 'running', 0)], 9e9, L, null).length === 0 && idle.idleState(ag('r', 'running', 0), L - 1, L, null).kind === 'none' && idle.idleState(ag('r', 'running', 0), L + 5000, L, null).kind === 'quiet');
check('idle: an agent in hand-off is skipped', idle.dueAgents([ag('h', 'done', 0)], 9e9, L, null, new Set(['h'])).length === 0 && idle.nextDeadline([ag('h', 'done', 0)], L, null, new Set(['h'])) === null);
check('idle: a dying agent is skipped', idle.dueAgents([ag('d', 'done', 0, true)], 9e9, L, null).length === 0);
check('idle: nextDeadline is the earliest of the eligible finished agents', idle.nextDeadline([ag('a', 'done', 5000), ag('b', 'done', 1000), ag('c', 'running', 0), ag('s', 'done', 0)], L, 's') === 1000 + L);
check('idle: nothing waiting means no timer', idle.nextDeadline([ag('c', 'running', 0)], L, null) === null && idle.nextDeadline([], L, null) === null);
check('idle: only the overdue agents are due', idle.dueAgents([ag('a', 'done', 0), ag('b', 'done', 100000)], L + 1, L, null).map((a) => a.id).join() === 'a');

process.exit(failed ? 1 : 0);
