// Pure checks for the permission prompts: the main-process core (src/main/permissions.js: sanitising, what the
// card shows, the broker that decides which answers are accepted, the exact stdin lines) and the renderer's
// list rules (lib/permissions.ts, types stripped with node:module like check-queue.mjs).
// No Claude, no Electron. Usage: npm run check   (exit code 1 if anything fails)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const perm = require(path.join(root, 'src/main/permissions.js'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-perm-'));
fs.writeFileSync(path.join(tmp, 'permissions.mjs'), stripTypeScriptTypes(fs.readFileSync(path.join(root, 'src/renderer/lib/permissions.ts'), 'utf8')));
const lib = await import(pathToFileURL(path.join(tmp, 'permissions.mjs')).href);
fs.rmSync(tmp, { recursive: true, force: true });

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  permissions: ${name}${detail ? `  (${detail})` : ''}`); };

// ----- sanitising -----
check('control characters are removed, newline and tab stay', perm.sanitizeText('a\u0000b\u0007c\td\ne\u009ff\u007f', 50) === 'abc\td\nef');
check('bidi and zero-width characters are removed', perm.sanitizeText('a‮b⁦c​d﻿e', 50) === 'abcde');
check('CRLF becomes LF', perm.sanitizeText('a\r\nb\rc', 50) === 'a\nb\nc');
check('non-strings give an empty string', perm.sanitizeText(42, 10) === '' && perm.sanitizeText(null, 10) === '' && perm.sanitizeText({}, 10) === '');
check('the length cap adds "..."', perm.sanitizeText('x'.repeat(100), 20) === `${'x'.repeat(17)}...`);
const t0 = Date.now();
const huge = perm.sanitizeText('y'.repeat(1_000_000), 4000);
check('a 1 MB string stays within the cap, fast', huge.length === 4000 && Date.now() - t0 < 200, `${huge.length} chars, ${Date.now() - t0} ms`);

// ----- what the card shows -----
const bash = perm.describeRequest({ tool_name: 'Bash', display_name: 'Bash', input: { command: 'mkdir x\necho hi' } });
check('Bash: tool, first line as summary, full command as detail', bash.tool === 'Bash' && bash.summary === 'mkdir x' && bash.detail === 'mkdir x\necho hi' && bash.truncatedLines === 0);
const bigFile = perm.describeRequest({ tool_name: 'Write', input: { file_path: '/p/a.txt', content: Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n') } });
check('Write: path, 12 lines, "N more lines"', bigFile.path === '/p/a.txt' && bigFile.detail.split('\n').length === 12 && bigFile.truncatedLines === 4988, `${bigFile.truncatedLines}`);
const longLine = perm.describeRequest({ tool_name: 'Write', input: { file_path: '/p/b', content: 'z'.repeat(100000) } });
check('Write: a 100000-char line is capped and flagged', longLine.detail.length <= 200 && longLine.truncated === true);
const manyLines = perm.describeRequest({ tool_name: 'Bash', input: { command: Array.from({ length: 3000 }, (_, i) => `echo ${i}`).join('\n') } });
check('Bash: 3000 lines are bounded with a marker', manyLines.detail.length <= 4000 && manyLines.truncatedLines > 0 && manyLines.truncated === true);
const other = perm.describeRequest({ tool_name: 'mcp__x__do', display_name: 'do', input: { a: 'b' }, agent_id: 'abc' });
check('unknown tools show their input as JSON, subagent flag set', other.tool === 'do' && other.detail.includes('"a": "b"') && other.viaSubagent === true);
const evil = perm.describeRequest({ tool_name: 'Bash', display_name: 'Bash‮', input: { command: '<img src=x onerror=alert(1)>\u0000' } });
check('markup is kept as plain text, control characters dropped', evil.detail === '<img src=x onerror=alert(1)>' && evil.tool === 'Bash');
let threw = false;
let garbage = [];
try { garbage = [null, undefined, 5, 'str', [], { input: 5 }, { tool_name: 7, input: null }, { tool_name: 'Bash', input: { command: 7 } }].map((r) => perm.describeRequest(r)); } catch { threw = true; }
check('garbage requests never throw', !threw && garbage.every((g) => typeof g.tool === 'string' && typeof g.detail === 'string'));
check('interactive tools are recognised', perm.isInteractiveOnly({ tool_name: 'AskUserQuestion' }) && perm.isInteractiveOnly({ tool_name: 'ExitPlanMode' })
  && perm.isInteractiveOnly({ tool_name: 'Bash', requires_user_interaction: true }) && !perm.isInteractiveOnly({ tool_name: 'Bash' }) && !perm.isInteractiveOnly(null));

// ----- broker -----
const request = (id, input = { command: 'mkdir a' }, extra = {}) => ({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: 'Bash', input, tool_use_id: 't1', ...extra } });
const timers = [];
const fakeTimers = { setTimer: (fn, ms) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; }, clearTimer: (t) => { t.cleared = true; } };
const timeouts = [];
const broker = perm.createBroker({ ...fakeTimers, now: () => 1000, timeoutMs: 5000, onTimeout: (x) => timeouts.push(x) });
const added = broker.add(request('r1'));
check('add returns the card data with an expiry', added.ok && added.view.requestId === 'r1' && added.view.expiresAt === 6000 && added.view.tool === 'Bash');
check('a duplicate id and a bad id are refused', broker.add(request('r1')).reason === 'duplicate' && broker.add({ request_id: 5 }).reason === 'invalid' && broker.add({}).reason === 'invalid');
check('a forged id is refused', broker.answer('forged', 'allow').ok === false && broker.pending().length === 1);
check('a decision other than allow/deny is refused', broker.answer('r1', 'yes').ok === false && broker.answer('r1', undefined).ok === false && broker.pending().length === 1);
const okAnswer = broker.answer('r1', 'allow');
check('allow answers with the STORED input', okAnswer.ok && okAnswer.response.behavior === 'allow' && okAnswer.response.updatedInput.command === 'mkdir a');
check('the first answer wins, a second is refused', broker.answer('r1', 'deny').ok === false && broker.pending().length === 0 && timers[0].cleared);
broker.add(request('r2'));
const denied = broker.answer('r2', 'deny');
check('deny has the fixed message', denied.ok && denied.response.behavior === 'deny' && denied.response.message === perm.DENY_MESSAGES.user && !('updatedInput' in denied.response));
broker.add(request('r3'));
check('cancel removes it once', broker.cancel('r3').ok && !broker.cancel('r3').ok && !broker.has('r3'));
broker.add(request('r4'));
broker.add(request('r5'));
const all = broker.denyAll('stopped');
check('denyAll returns each pending request once and empties the broker', all.length === 2 && all.every((a) => a.response.behavior === 'deny') && broker.pending().length === 0 && broker.denyAll().length === 0);
broker.add(request('r6'));
const timer = timers[timers.length - 1];
timer.fn();
timer.fn();
check('the timeout denies exactly once and removes the request', timeouts.length === 1 && timeouts[0].requestId === 'r6' && timeouts[0].response.behavior === 'deny' && !broker.has('r6') && timer.ms === 5000);
broker.add(request('r7'));
check('clear forgets without answering', broker.clear().join() === 'r7' && broker.pending().length === 0);
const small = perm.createBroker({ ...fakeTimers });
let lastReason = '';
for (let i = 0; i < perm.MAX_PENDING + 1; i++) { const r = small.add(request(`c${i}`)); if (!r.ok) lastReason = r.reason; }
check('the pending list is capped', lastReason === 'full' && small.pending().length === perm.MAX_PENDING);
const mutated = { command: 'rm -rf /tmp/x' };
const keep = perm.createBroker({ ...fakeTimers });
keep.add(request('k1', mutated));
mutated.command = 'something else';
check('allow uses main\'s own copy of the input, even if the original object changes later', keep.answer('k1', 'allow').response.updatedInput.command === 'rm -rf /tmp/x');

// ----- mode policy, replies, live mode switch lines -----
check('policy table: default asks, bypass allows, acceptEdits and plan deny, unknown asks',
  perm.policyForMode('default') === 'ask' && perm.policyForMode('bypassPermissions') === 'allow' && perm.policyForMode('acceptEdits') === 'deny'
  && perm.policyForMode('plan') === 'deny' && perm.policyForMode('dontAsk') === 'ask' && perm.policyForMode(undefined) === 'ask');
check('tightening: from bypass or acceptEdits to something stricter only',
  perm.isTightening('bypassPermissions', 'default') && perm.isTightening('bypassPermissions', 'plan') && perm.isTightening('acceptEdits', 'default')
  && perm.isTightening('acceptEdits', 'plan') && !perm.isTightening('default', 'bypassPermissions') && !perm.isTightening('plan', 'acceptEdits')
  && !perm.isTightening('default', 'plan') && !perm.isTightening('bypassPermissions', 'bypassPermissions') && !perm.isTightening('x', 'default'));
check('reply cleaning: control and bidi removed, trimmed', perm.sanitizeReply('  use \u0007staging‮ folder\u0000  ') === 'use staging folder');
check('reply cleaning: 3000 characters become 2000', perm.sanitizeReply('a'.repeat(3000)).length === 2000);
check('reply cleaning: empty, blank and non-strings give ""', perm.sanitizeReply('') === '' && perm.sanitizeReply(' \n\t ') === '' && perm.sanitizeReply('\u0000\u0007') === '' && perm.sanitizeReply(5) === '' && perm.sanitizeReply(null) === '');
const rb = perm.createBroker({ ...fakeTimers });
rb.add(request('p1'));
check('an allow that carries a message is refused and stays pending', rb.answer('p1', 'allow', 'x').ok === false && rb.answer('p1', 'allow', '').ok === false && rb.has('p1'));
check('a reply that is empty after cleaning is refused and stays pending', rb.answer('p1', 'deny', ' \u0007 ').ok === false && rb.answer('p1', 'deny', 7).ok === false && rb.has('p1'));
const rep = rb.answer('p1', 'deny', 'use "staging" instead\nplease');
check('a reply denies with the wrapped text, no interrupt, no updatedInput',
  rep.ok && rep.response.behavior === 'deny' && rep.reply === 'use "staging" instead\nplease'
  && rep.response.message === 'The user denied this tool call and replied: "use \\"staging\\" instead\\nplease". Do what the user replied instead of retrying the denied call.'
  && !('interrupt' in rep.response) && !('updatedInput' in rep.response));
check('a second reply for the same id is refused', rb.answer('p1', 'deny', 'again').ok === false && rb.answer('p1', 'deny').ok === false);
check('a plain deny and a plain allow still have no message text of the user', (rb.add(request('p2')), rb.answer('p2', 'deny').response.message === perm.DENY_MESSAGES.user));
rb.add(request('p3', { command: 'echo three' }));
rb.add(request('p4', { command: 'echo four' }));
const resolved = rb.resolveAll('allow', 'mode');
check('resolveAll(allow) answers every pending request with main\'s stored input and leaves nothing pending',
  resolved.length === 2 && resolved.every((r) => r.ok && r.response.behavior === 'allow') && resolved[0].response.updatedInput.command === 'echo three'
  && resolved[1].response.updatedInput.command === 'echo four' && rb.pending().length === 0 && rb.resolveAll('allow').length === 0);
rb.add(request('p5'));
check('autoAnswer deny uses the mode message; an unknown id is refused', rb.autoAnswer('p5', 'deny', 'mode').response.message === perm.DENY_MESSAGES.mode && rb.autoAnswer('p5', 'deny').ok === false);
check('set_permission_mode line: allowlisted modes only',
  JSON.parse(perm.buildSetModeLine('m1', 'bypassPermissions')).request.mode === 'bypassPermissions' && perm.buildSetModeLine('m1', 'plan').endsWith('\n')
  && perm.buildSetModeLine('m1', 'dontAsk') === null && perm.buildSetModeLine('m1', 'auto') === null && perm.buildSetModeLine('m1', 'x') === null
  && perm.buildSetModeLine('m1', undefined) === null && perm.buildSetModeLine('', 'plan') === null);
const okMode = perm.parseModeResponse({ type: 'control_response', response: { subtype: 'success', request_id: 'm1', response: { mode: 'plan' } } });
const badMode = perm.parseModeResponse({ type: 'control_response', response: { subtype: 'error', request_id: 'm2', error: 'x', error_code: 'bypass_not_launched' } });
check('parseModeResponse: success, error with code, anything else is null',
  okMode.ok && okMode.requestId === 'm1' && okMode.mode === 'plan' && !badMode.ok && badMode.errorCode === 'bypass_not_launched'
  && perm.parseModeResponse({ type: 'assistant' }) === null && perm.parseModeResponse(null) === null && perm.parseModeResponse({ type: 'control_response' }) === null);

// ----- stdin lines (shapes captured from the real CLI) -----
const allowLine = perm.buildControlResponse('abc', { behavior: 'allow', updatedInput: { file_path: 'x', content: 'hi' } });
check('allow line matches the verified shape', allowLine === '{"type":"control_response","response":{"subtype":"success","request_id":"abc","response":{"behavior":"allow","updatedInput":{"file_path":"x","content":"hi"}}}}\n');
const denyLine = perm.buildControlResponse('abc', { behavior: 'deny', message: 'no' });
check('deny line matches the verified shape', denyLine === '{"type":"control_response","response":{"subtype":"success","request_id":"abc","response":{"behavior":"deny","message":"no"}}}\n');
check('error line for unsupported requests', JSON.parse(perm.buildErrorResponse('q', 'unsupported')).response.subtype === 'error');
const userLine = JSON.parse(perm.buildUserLine('multi\nline "quoted"'));
check('user line carries the prompt as one text block', userLine.type === 'user' && userLine.message.content[0].text === 'multi\nline "quoted"' && perm.buildUserLine('a').endsWith('\n'));
check('user line without images is byte-identical to the old format', perm.buildUserLine('hi') === '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}\n' && perm.buildUserLine('hi', []) === perm.buildUserLine('hi'));
{
  const a = Buffer.from([1, 2, 3, 250]); const b = Buffer.from('second');
  const line = perm.buildUserLine('what is this', [{ mime: 'image/png', buffer: a }, { mime: 'image/jpeg', buffer: b }]);
  const c = JSON.parse(line).message.content;
  check('user line with images: image blocks first, then one text block', line.endsWith('\n') && c.length === 3 && c[0].type === 'image' && c[1].type === 'image' && c[2].type === 'text' && c[2].text === 'what is this');
  check('user line with images: base64 source and the given media types', c[0].source.type === 'base64' && c[0].source.media_type === 'image/png' && Buffer.from(c[0].source.data, 'base64').equals(a) && c[1].source.media_type === 'image/jpeg' && Buffer.from(c[1].source.data, 'base64').equals(b));
  check('user line with images and empty text has no text block', JSON.parse(perm.buildUserLine('', [{ mime: 'image/png', buffer: a }])).message.content.every((x) => x.type === 'image'));
}

// ----- renderer list rules (lib/permissions.ts) -----
const req = (id, owner = { kind: 'quest', wsId: 'w' }) => ({ requestId: id, owner, tool: 'Bash', summary: 's', detail: 'd', truncatedLines: 0, truncated: false, path: '', viaSubagent: false, expiresAt: 10_000 });
let list = [];
list = lib.addRequest(list, req('a'));
list = lib.addRequest(list, req('b'));
list = lib.addRequest(list, req('a'));
check('FIFO, no duplicate id', list.map((r) => r.requestId).join() === 'a,b');
let big = [];
for (let i = 0; i < 25; i++) big = lib.addRequest(big, req(`x${i}`));
check('the list is capped', big.length === lib.MAX_REQUESTS && lib.MAX_REQUESTS === 20);
check('resolve removes one id', lib.resolveRequest(list, 'a').map((r) => r.requestId).join() === 'b' && lib.resolveRequest(list, 'zz') === list);
const mixed = [req('q1'), req('a1', { kind: 'agent', agentId: 'ag' }), req('q2', { kind: 'quest', wsId: 'other' })];
check('forOwner picks by owner', lib.forOwner(mixed, { kind: 'quest', wsId: 'w' }).length === 1 && lib.forOwner(mixed, { kind: 'agent', agentId: 'ag' }).length === 1);
check('clearOwner drops all of one owner', lib.clearOwner(mixed, { kind: 'agent', agentId: 'ag' }).length === 2 && lib.clearOwner(mixed, { kind: 'agent', agentId: 'nope' }) === mixed);
check('countdown label', lib.countdownLabel(10_000, 5_000) === '0:05' && lib.countdownLabel(400_000, 100_000) === '5:00' && lib.countdownLabel(1000, 5000) === '0:00');
const frozen = Object.freeze([Object.freeze(req('f'))]);
let mutatedInput = false;
try { lib.addRequest(frozen, req('g')); lib.resolveRequest(frozen, 'f'); lib.clearOwner(frozen, { kind: 'quest', wsId: 'w' }); } catch { mutatedInput = true; }
check('inputs are not mutated', !mutatedInput);

if (failed) { console.log(`${failed} permission check(s) failed`); process.exit(1); }
