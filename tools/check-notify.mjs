// Pure checks for the notification core (main/notify.js): labels, durations, failure phrases, trackers, the burst notifier,
// the spam limit and the settings flags. Usage: npm run check   (exit code 1 if anything fails)

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const N = createRequire(import.meta.url)(path.join(root, 'src/main/notify.js'));

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  notify: ${name}${detail ? `  (${detail})` : ''}`); };

// ----- cleanLabel -----
check('a plain name stays', N.cleanLabel('version-controller') === 'version-controller');
check('control, bidi and zero-width characters go', N.cleanLabel('a\u0007b\u202ec\u200bd') === 'a b c d', JSON.stringify(N.cleanLabel('a\u0007b\u202ec\u200bd')));
check('a unix path is removed', N.cleanLabel('/Users/x/y', 'fb') === 'fb');
check('a windows path is removed', N.cleanLabel('C:\\x\\y', 'fb') === 'fb');
check('a path inside a name is removed', N.cleanLabel('build /Users/x/y now') === 'build now');
check('a long name is capped at 40', N.cleanLabel('x'.repeat(100)).length === 40);
check('empty and non-strings use the fallback', N.cleanLabel('', 'fb') === 'fb' && N.cleanLabel(null, 'fb') === 'fb' && N.cleanLabel('   \u200b ', 'fb') === 'fb');

// ----- formatDuration -----
const fd = N.formatDuration;
check('duration edge cases', fd(0) === '0s' && fd(999) === '1s' && fd(59999) === '59s' && fd(60000) === '1m' && fd(72000) === '1m 12s'
  && fd(3600000) === '1h' && fd(7380000) === '2h 3m', [fd(0), fd(999), fd(59999), fd(60000), fd(72000), fd(3600000), fd(7380000)].join('|'));
check('duration never negative or NaN', fd(-5) === '0s' && fd(NaN) === '0s' && fd(undefined) === '0s' && fd(Infinity) === '0s');

// ----- coerceFlag -----
check('coerceFlag only takes real booleans', N.coerceFlag(false) === false && N.coerceFlag(true) === true && N.coerceFlag('no') === true
  && N.coerceFlag(undefined) === true && N.coerceFlag(null) === true && N.coerceFlag(0) === true && N.coerceFlag(1) === true);
check('coerceFlag uses the given default', N.coerceFlag('x', false) === false);

// ----- classifyFailure -----
for (const code of ['not-found', 'start', 'host-unsupported', 'mode-switch', 'permission-timeout', 'settings']) {
  const r = N.classifyFailure({ code });
  check(`code ${code} has a fixed phrase`, r.code === code && typeof r.phrase === 'string' && r.phrase.length > 10);
}
check('not-found hints at CLAUDE_BIN', /CLAUDE_BIN/.test(N.classifyFailure({ code: 'not-found' }).phrase));
check('a login problem is recognised from the message', N.classifyFailure({ message: 'Error: Invalid API key' }).code === 'login'
  && N.classifyFailure({ message: 'Please run /login' }).code === 'login');
check('a result error', N.classifyFailure({ resultError: true }).code === 'result');
check('an exit code', /code 2\./.test(N.classifyFailure({ exitCode: 2 }).phrase));
check('unknown falls back to the generic phrase', /did not finish cleanly/.test(N.classifyFailure({ message: 'boom' }).phrase) && /did not finish cleanly/.test(N.classifyFailure().phrase));
{
  const secret = 'sk-ant-SECRET123 at /Users/me/secret/project';
  const phrases = [N.classifyFailure({ message: secret }), N.classifyFailure({ code: 'start', message: secret }), N.classifyFailure({ message: `Invalid API key ${secret}` }),
    N.classifyFailure({ exitCode: 1, message: secret })].map((r) => r.phrase).join('\n');
  check('raw stderr never reaches a phrase', !/SECRET|sk-ant|\/Users/.test(phrases));
  check('an unknown code from a caller is not trusted', N.classifyFailure({ code: '<script>' }).code === 'unknown');
}

// ----- tracker -----
const clock = { t: 1000 };
const now = () => clock.t;
const run = (events, { stop = false, kind = 'agent' } = {}) => {
  const tr = N.createTracker({ kind, wsId: 'w1', agentId: kind === 'agent' ? 'a1' : null, label: 'gitama', now });
  const early = [];
  for (const [dt, ev] of events) { clock.t += dt; const e = tr.event(ev); if (e) early.push(e); }
  if (stop) tr.markStopped();
  return { tr, early };
};
{
  const { tr } = run([[0, { type: 'start' }], [5000, { type: 'end', code: 0 }]]);
  const o = tr.outcome();
  check('a clean run is done with its span', o.type === 'done' && o.endedAt - o.startedAt === 5000 && o.label === 'gitama' && o.target.wsId === 'w1' && o.target.agentId === 'a1');
}
{
  const o = run([[0, { type: 'start' }], [1, { type: 'error', message: 'x', errorCode: 'not-found' }], [1, { type: 'end', code: -1 }]]).tr.outcome();
  check('an error event is a failure with its code', o.type === 'failed' && o.reason.code === 'not-found');
}
{
  const o = run([[0, { type: 'start' }], [1, { type: 'end', code: 3 }]]).tr.outcome();
  check('a non-zero exit is a failure', o.type === 'failed' && o.reason.code === 'exit');
}
{
  const o = run([[0, { type: 'start' }], [1, { type: 'result', isError: true }], [1, { type: 'end', code: 0 }]]).tr.outcome();
  check('result.isError is a failure', o.type === 'failed' && o.reason.code === 'result');
}
{
  const o = run([[0, { type: 'start' }], [1, { type: 'error', message: 'Not logged in' }], [1, { type: 'error', errorCode: 'start' }], [1, { type: 'end', code: 1 }]]).tr.outcome();
  check('the first failure reason wins', o.reason.code === 'login');
}
{
  const o = run([[0, { type: 'start' }], [1, { type: 'error', message: 'x' }], [1, { type: 'end', code: 130 }]], { stop: true }).tr.outcome();
  check('stopped wins over a failure', o.type === 'stopped');
}
{
  const { tr, early } = run([[0, { type: 'start' }], [1, { type: 'permission-resolved', how: 'timeout' }], [1, { type: 'permission-resolved', how: 'timeout' }], [1, { type: 'end', code: 0 }]]);
  check('a permission timeout is told once, at once', early.length === 1 && early[0].type === 'failed' && early[0].reason.code === 'permission-timeout');
  check('and the run is not reported again at its end', tr.outcome().type === 'reported');
}
{
  const tr = N.createTracker({ kind: 'agent', label: 'x', now });
  tr.event({ type: 'error', message: 'Agent x is already running' });
  const early = tr.event({ type: 'permission-resolved', how: 'timeout' });
  tr.event({ type: 'end', code: 1 });
  check('events before start are ignored', early === null && tr.ended() === false);
}
{
  const o = N.createTracker({ kind: 'quest', label: '/Users/x/secret', now }).outcome();
  check('a path-like label falls back', o.label === 'Claude');
}

// ----- notifier -----
function harness({ busy = () => false, watching = () => false, flags = { done: true, fail: true }, minRunMs = 15000, canNative = true, limiter } = {}) {
  let t = 0;
  const timers = [];
  const delivered = [];
  const notifier = N.createNotifier({
    now: () => t, minRunMs, quietMs: 1500,
    getFlags: () => flags, isBusy: () => busy(), watching: (target) => watching(target), canNative: () => canNative,
    limiter: limiter || N.createLimiter({ now: () => t }),
    deliver: (n) => delivered.push(n),
    setTimer: (fn, ms) => { const h = { fn, at: t + ms, off: false, unref() {} }; timers.push(h); return h; },
    clearTimer: (h) => { if (h) h.off = true; },
  });
  const advance = (ms) => {
    const end = t + ms;
    for (;;) {
      const next = timers.filter((h) => !h.off && h.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      next.off = true; t = Math.max(t, next.at); next.fn();
    }
    t = end;
  };
  const at = () => t;
  return { notifier, advance, delivered, at, timers, setFlags: (f) => { flags = f; } };
}
const item = (over = {}) => ({ type: 'done', label: 'alpha', startedAt: 0, endedAt: 20000, reason: null, target: { wsId: 'w1', agentId: 'a1' }, ...over });
const failItem = (over = {}) => item({ type: 'failed', startedAt: 0, endedAt: 800, reason: N.classifyFailure({ code: 'start' }), ...over });
{
  const h = harness();
  h.advance(20000);
  h.notifier.add(item());
  h.advance(1400);
  check('nothing fires before the quiet period', h.delivered.length === 0);
  h.advance(200);
  check('a long success notifies once after it', h.delivered.length === 1 && h.delivered[0].kind === 'done' && /alpha finished \(20s\)/.test(h.delivered[0].title) && h.delivered[0].native === true, JSON.stringify(h.delivered[0]));
}
{
  const h = harness();
  h.notifier.add(item({ startedAt: 0, endedAt: 5000 }));
  h.advance(5000);
  check('a short lone success is silent', h.delivered.length === 0);
}
{
  const h = harness();
  h.notifier.add(item({ label: 'a', startedAt: 0, endedAt: 6000 }));
  h.advance(300);
  h.notifier.add(item({ label: 'b', startedAt: 6100, endedAt: 12000 }));
  h.advance(300);
  h.notifier.add(item({ label: 'c', startedAt: 12100, endedAt: 18000 }));
  h.advance(3000);
  check('three short steps over the minimum are ONE notification', h.delivered.length === 1 && h.delivered[0].title === '3 tasks finished' && /a, b, c/.test(h.delivered[0].body), JSON.stringify(h.delivered));
}
{
  const h = harness();
  h.notifier.add(failItem());
  h.advance(2000);
  check('a failure after 1 s notifies', h.delivered.length === 1 && h.delivered[0].kind === 'failed' && /failed/.test(h.delivered[0].short));
  check('a failure text has no path', !/\//.test(`${h.delivered[0].title}${h.delivered[0].body}`));
}
{
  const h = harness();
  h.notifier.add({ ...item(), type: 'stopped' });
  h.advance(5000);
  check('stopped is silent', h.delivered.length === 0 && h.notifier.pending() === 0);
}
{
  const h = harness();
  h.notifier.add(item({ label: 'a' })); h.advance(500); h.notifier.add(item({ label: 'b' })); h.advance(500); h.notifier.add(failItem({ label: 'c' }));
  h.advance(5000);
  check('a burst in the quiet period is one delivery', h.delivered.length === 1 && h.delivered[0].title === '1 failed, 2 finished' && h.delivered[0].kind === 'mixed', h.delivered[0]?.title);
  check('the click target is the failure', h.delivered[0].target.wsId === 'w1');
}
{
  let busy = true;
  const h = harness({ busy: () => busy });
  h.notifier.add(item());
  h.advance(10000);
  check('a success waits while other work runs', h.delivered.length === 0 && h.notifier.pending() === 1);
  busy = false;
  h.advance(2000);
  check('and fires when it is over', h.delivered.length === 1);
}
{
  const h = harness({ busy: () => true });
  h.notifier.add(failItem());
  h.advance(2000);
  check('a failure does not wait for other work', h.delivered.length === 1);
}
{
  const h = harness({ watching: (t) => t.agentId === 'a1' });
  h.notifier.add(item());
  h.notifier.add(item({ label: 'other', target: { wsId: 'w1', agentId: 'a2' } }));
  h.advance(3000);
  check('items the user is looking at are dropped, others stay', h.delivered.length === 1 && /other finished/.test(h.delivered[0].title));
}
{
  const h = harness({ flags: { done: false, fail: true } });
  h.notifier.add(item()); h.notifier.add(failItem({ label: 'bad' }));
  h.advance(3000);
  check('notifyDone off silences only successes', h.delivered.length === 1 && h.delivered[0].kind === 'failed');
}
{
  const h = harness({ flags: { done: true, fail: false } });
  h.notifier.add(failItem());
  h.advance(3000);
  check('notifyFail off silences failures', h.delivered.length === 0);
  const h2 = harness({ flags: { done: true, fail: true } });
  h2.notifier.add(item());
  h2.setFlags({ done: false, fail: true });
  h2.advance(3000);
  check('flags are read when it fires, not when it was added', h2.delivered.length === 0);
}
{
  const h = harness({ canNative: false });
  h.notifier.add(item());
  h.advance(3000);
  check('native false is passed on (in-app cue only)', h.delivered.length === 1 && h.delivered[0].native === false);
}
{
  const h = harness();
  for (let i = 0; i < 80; i++) h.notifier.add(failItem({ label: `n${i}` }));
  check('MAX_PENDING bounds the list', h.notifier.pending() === N.MAX_PENDING);
  h.notifier.dispose();
  check('dispose clears the timer and the list', h.timers.every((x) => x.off) && h.notifier.pending() === 0);
  h.notifier.add(failItem());
  h.advance(5000);
  check('a disposed notifier stays quiet', h.delivered.length === 0);
}

// ----- describe -----
{
  const d = N.describe([item({ label: 'version-controller', startedAt: 0, endedAt: 72000 })]);
  check('one success reads "<label> finished (1m 12s)"', d.title === 'version-controller finished (1m 12s)' && d.short === d.title);
  const f = N.describe([failItem({ label: 'gitama', reason: N.classifyFailure({ code: 'not-found' }) })]);
  check('one failure has the label and a hint', f.title === 'gitama failed' && /CLAUDE_BIN/.test(f.body) && /^gitama failed: /.test(f.short));
  const s = N.describe([N.systemFailure('Settings', 'settings', 5)]);
  check('a settings failure reads as a sentence', /^Settings could not be saved/.test(s.short) && s.target === null);
  const many = N.describe([1, 2, 3, 4, 5].map((i) => item({ label: `t${i}` })));
  check('several successes list up to three names', many.title === '5 tasks finished' && many.body === 't1, t2, t3 and 2 more');
}

// ----- permission note (app hidden) -----
{
  const n = N.permissionNote({ label: 'version-controller', target: { wsId: 'w1', agentId: 'a1' } });
  check('a permission note has fixed text', n.title === 'version-controller needs your OK' && n.body === 'Open Claudebar Heroes to allow or deny.' && n.kind === 'permission' && n.count === 1);
  check('its target is copied', n.target.wsId === 'w1' && n.target.agentId === 'a1');
  const dirty = N.permissionNote({ label: '/Users/me/secret\u202e rm -rf x'.repeat(5), target: { wsId: 'w' } });
  check('a path-like or hostile label is cleaned and capped', !/\/Users|\u202e/.test(JSON.stringify(dirty)) && dirty.title.length <= 60);
  check('no label falls back, no target gives null', N.permissionNote({}).title === 'Claude needs your OK' && N.permissionNote({}).target === null && N.permissionNote().kind === 'permission');
  const tr = N.createTracker({ kind: 'agent', wsId: 'w1', agentId: 'a1', label: 'gitama' });
  check('a tracker builds the note for its own run', tr.permissionNote().title === 'gitama needs your OK' && tr.permissionNote().target.agentId === 'a1');
  check('a tracker counts the requests that wait, resolved ones and the end clear them', (() => {
    const t = N.createTracker({ kind: 'quest', wsId: 'w', label: 'x' });
    t.event({ type: 'start' }); t.event({ type: 'permission', requestId: 'a' }); t.event({ type: 'permission', requestId: 'b' });
    const two = t.waiting() === 2;
    t.event({ type: 'permission-resolved', requestId: 'a', how: 'allowed' });
    const one = t.waiting() === 1;
    t.event({ type: 'end', code: 0 });
    return two && one && t.waiting() === 0;
  })());
  check('a permission event never ends or fails a run', (() => { tr.event({ type: 'start' }); return tr.event({ type: 'permission', requestId: 'x', tool: 'Bash', detail: 'rm -rf /' }) === null && !tr.ended(); })());
}

// ----- running() and the counts the floating bubble latches -----
{
  const t = N.createTracker({ kind: 'quest', wsId: 'w', label: 'x' });
  check('running(): false before start, true after, false after the end', (() => {
    const a = t.running();
    t.event({ type: 'start' });
    const b = t.running();
    t.event({ type: 'end', code: 0 });
    return a === false && b === true && t.running() === false;
  })());
  const item = (type, label) => ({ type, label, startedAt: 0, endedAt: 1000, reason: type === 'failed' ? { code: 'x', phrase: 'p' } : null, target: null });
  const one = N.describe([item('done', 'a')]);
  const mixed = N.describe([item('done', 'a'), item('failed', 'b'), item('failed', 'c')]);
  check('describe() adds counts and keeps kind', one.counts.done === 1 && one.counts.failed === 0 && one.kind === 'done' && mixed.counts.done === 1 && mixed.counts.failed === 2 && mixed.kind === 'mixed');
}

// ----- limiter -----
{
  let t = 0;
  const lim = N.createLimiter({ now: () => t });
  const ok = [1, 2, 3, 4, 5].map((i) => lim.allow(`m${i}`));
  check('the 5th in a minute is denied', ok.join() === 'true,true,true,true,false', ok.join());
  t = 61000;
  check('and allowed again after the window', lim.allow('m6') === true);
  const l2 = N.createLimiter({ now: () => t });
  t = 0;
  check('identical text is deduped', l2.allow('same') === true && l2.allow('same') === false);
  t = 61000;
  check('and allowed after the dedupe window', l2.allow('same') === true);
  check('dedupe can be bypassed (the test button)', l2.allow('same', { dedupe: false }) === true);
}

process.exit(failed ? 1 : 0);
