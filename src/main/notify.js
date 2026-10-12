// Pure core of the "work finished / something failed" notifications. No electron import: main.js feeds it
// the events it already sees and shows what it decides (tools/check-notify.mjs tests this file).
//
// Nothing here ever carries raw Claude text: failures become fixed phrases, labels (project and agent names)
// are cleaned, and the renderer only displays the strings built here.

const MIN_RUN_MS = 15000;   // a success is only worth a notification when the burst of work lasted this long
const QUIET_MS = 1500;      // a burst ends when no run finished for this long (chain steps and queue drains follow within ms)
const MAX_PER_MINUTE = 4;   // native notifications per rolling minute; more only get the in-app cue
const DEDUPE_MS = 60000;    // identical text is not shown natively twice within this time
const MAX_PENDING = 50;     // oldest outcomes are dropped beyond this
const MAX_LABEL = 40;

// ----- text helpers -----

// Control, bidi and zero-width characters.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** A name that is safe to show: invisible characters and anything that looks like a path removed, capped at 40. */
function cleanLabel(text, fallback = 'Claude') {
  const raw = typeof text === 'string' ? text : '';
  const cleaned = raw
    .replace(INVISIBLE, ' ')
    .split(/\s+/)
    .filter((token) => token && !/[\\/]/.test(token) && !/^~/.test(token))
    .join(' ')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > MAX_LABEL ? `${cleaned.slice(0, MAX_LABEL - 3)}...` : cleaned;
}

/** 45s, 1m 12s, 2h 3m. Never negative, never NaN. */
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  if (ms < 1000) return '1s';
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s`;
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Only a real boolean is accepted; anything else gives the default. */
function coerceFlag(value, fallback = true) {
  return typeof value === 'boolean' ? value : fallback;
}

// ----- failures -----

const PHRASES = {
  'not-found': 'Claude Code was not found. Is Claude Code installed? Set CLAUDE_BIN to its path.',
  start: 'Claude could not be started.',
  'host-unsupported': 'this Claude Code is too old for permission prompts. Update Claude Code.',
  'mode-switch': 'the run was stopped because the permission mode could not be changed. Send your message again.',
  'permission-timeout': 'a permission request timed out and was denied.',
  login: 'Claude is not logged in. Run claude and log in.',
  settings: 'could not be saved (disk full or folder not writable).',
  result: 'Claude reported an error. Open the chat for details.',
};
const GENERIC_PHRASE = 'did not finish cleanly. Open the chat for details.';
const LOGIN_RE = /not logged in|\/login|please (?:run )?log ?in|invalid (?:x-)?api[ -]?key|authentication[_ ]error|\b401\b/i;

/**
 * Maps what main knows about a failure to a FIXED phrase. `message` (stderr text) is only used to recognise a
 * login problem; it is never copied into the phrase.
 */
function classifyFailure({ code, message, exitCode, resultError } = {}) {
  if (typeof code === 'string' && PHRASES[code]) return { code, phrase: PHRASES[code] };
  if (typeof message === 'string' && LOGIN_RE.test(message)) return { code: 'login', phrase: PHRASES.login };
  if (resultError) return { code: 'result', phrase: PHRASES.result };
  if (Number.isInteger(exitCode) && exitCode !== 0) {
    return { code: 'exit', phrase: `Claude exited with code ${exitCode}. Open the chat for details.` };
  }
  return { code: 'unknown', phrase: GENERIC_PHRASE };
}

// ----- one run -----

/**
 * Follows ONE process (the Expedition run or one agent) from its events. It only observes. `event()` returns an
 * outcome at once only for a permission request that timed out (told once; the run is then not reported again).
 */
function createTracker({ kind, wsId = null, agentId = null, label, now = Date.now }) {
  const target = { wsId, agentId };
  const name = cleanLabel(label, kind === 'agent' ? 'An agent' : 'Claude');
  let startedAt = null;
  let endedAt = null;
  let endCode;
  let first = null;      // the first failure reason wins
  let resultError = false;
  let stopped = false;
  let told = false;      // a permission timeout was already reported
  let ended = false;

  const failure = (reason, at) => ({ type: 'failed', label: name, startedAt: startedAt ?? at, endedAt: at, reason, target: { ...target } });

  return {
    kind,
    event(ev) {
      if (!ev || typeof ev !== 'object') return null;
      if (ev.type === 'start') { if (startedAt === null) startedAt = now(); return null; }
      if (startedAt === null || ended) return null; // nothing counts before the process started (e.g. "already running")
      if (ev.type === 'error') {
        if (!first) first = { code: typeof ev.errorCode === 'string' ? ev.errorCode : undefined, message: typeof ev.message === 'string' ? ev.message : '' };
      } else if (ev.type === 'result') {
        if (ev.isError) resultError = true;
      } else if (ev.type === 'permission-resolved' && ev.how === 'timeout') {
        if (!told && !stopped) {
          told = true;
          return failure(classifyFailure({ code: 'permission-timeout' }), now());
        }
      } else if (ev.type === 'end') {
        ended = true;
        endedAt = now();
        endCode = ev.code;
      }
      return null;
    },
    /** The user pressed Stop (or closed the tab): the run's end is silent. */
    markStopped() { stopped = true; },
    ended: () => ended,
    /** What happened, once the run has ended. */
    outcome() {
      const at = endedAt ?? now();
      if (stopped) return { type: 'stopped', label: name, startedAt: startedAt ?? at, endedAt: at, reason: null, target: { ...target } };
      if (told) return { type: 'reported', label: name, startedAt: startedAt ?? at, endedAt: at, reason: null, target: { ...target } };
      const exitCode = typeof endCode === 'number' ? endCode : undefined;
      const bad = first || resultError || endCode !== 0;
      if (bad) {
        const reason = classifyFailure({ code: first?.code, message: first?.message, resultError, exitCode });
        return failure(reason, at);
      }
      return { type: 'done', label: name, startedAt: startedAt ?? at, endedAt: at, reason: null, target: { ...target } };
    },
  };
}

/** A failure that no run owns (e.g. settings could not be written). */
function systemFailure(label, code, at) {
  return { type: 'failed', label: cleanLabel(label, 'Claudebar Heroes'), startedAt: at, endedAt: at, reason: classifyFailure({ code }), target: null, system: true };
}

// ----- the words -----

const failureText = (item) => (item.system ? `${item.label} ${item.reason.phrase}` : `${item.label} failed: ${item.reason.phrase}`);

/**
 * One notification for a group of outcomes. `title`/`short` are the headline (the hero bubble and toast show `short`),
 * `body` the detail. The click target is the first failure, else the last item.
 */
function describe(items) {
  const done = items.filter((i) => i.type === 'done');
  const failed = items.filter((i) => i.type === 'failed');
  const kind = failed.length && done.length ? 'mixed' : failed.length ? 'failed' : 'done';
  const names = (list) => {
    const shown = list.slice(0, 3).map((i) => i.label).join(', ');
    return list.length > 3 ? `${shown} and ${list.length - 3} more` : shown;
  };
  const target = (failed[0] || items[items.length - 1] || {}).target || null;
  let title;
  let body;
  if (items.length === 1) {
    const item = items[0];
    if (item.type === 'failed') {
      title = item.system ? failureText(item) : `${item.label} failed`;
      body = item.system ? '' : item.reason.phrase;
    } else {
      title = `${item.label} finished (${formatDuration(item.endedAt - item.startedAt)})`;
      body = '';
    }
    return { kind, title, body, short: item.type === 'failed' ? failureText(item) : title, target };
  }
  if (kind === 'done') {
    title = `${done.length} tasks finished`;
    body = names(done);
  } else if (kind === 'failed') {
    title = `${failed.length} tasks failed`;
    body = failed.slice(0, 3).map((i) => failureText(i)).join(' ');
  } else {
    title = `${failed.length} failed, ${done.length} finished`;
    body = `${failureText(failed[0])}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ''}`;
  }
  return { kind, title, body, short: title, target };
}

// ----- spam limit -----

function createLimiter({ max, windowMs = 60000, dedupeMs, now = Date.now } = {}) {
  max = max ?? MAX_PER_MINUTE;
  dedupeMs = dedupeMs ?? DEDUPE_MS;
  let sent = [];
  const seen = new Map(); // text -> time it was allowed
  return {
    /** True when a native notification with this text may be shown now (and counts it). */
    allow(text, { dedupe = true } = {}) {
      const t = now();
      sent = sent.filter((at) => t - at < windowMs);
      for (const [key, at] of seen) if (t - at >= dedupeMs) seen.delete(key);
      if (dedupe && seen.has(text)) return false;
      if (sent.length >= max) return false;
      sent.push(t);
      seen.set(text, t);
      return true;
    },
  };
}

// ----- the burst -----

/**
 * Collects outcomes and delivers them as ONE notification once things went quiet. Rules, checked at fire time:
 * stopped runs are never added; a kind whose flag is off is dropped; successes need the burst (earliest start to
 * latest end) to last `minRunMs`, failures never do; items the user is looking at (`watching`) are dropped; while
 * other work runs (`isBusy`) successes wait but failures do not. `deliver` is the only side effect.
 */
function createNotifier({
  now = Date.now, minRunMs = MIN_RUN_MS, quietMs = QUIET_MS,
  getFlags = () => ({ done: true, fail: true }), isBusy = () => false, watching = () => false,
  canNative = () => true, limiter = createLimiter({ now }), deliver = () => {},
  setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  let pending = [];
  let lastAdd = 0;
  let timer = null;
  let disposed = false;

  const arm = (ms) => {
    if (timer) clearTimer(timer);
    timer = setTimer(tick, Math.max(1, ms));
    timer?.unref?.();
  };

  function flush() {
    const items = pending;
    pending = [];
    const flags = getFlags() || {};
    let list = items.filter((i) => (i.type === 'done' ? flags.done !== false : i.type === 'failed' ? flags.fail !== false : false));
    const doneItems = list.filter((i) => i.type === 'done');
    if (doneItems.length) {
      const span = Math.max(...list.map((i) => i.endedAt)) - Math.min(...list.map((i) => i.startedAt));
      if (span < minRunMs) list = list.filter((i) => i.type !== 'done');
    }
    list = list.filter((i) => !(i.target && watching(i.target)));
    if (!list.length) return;
    const note = describe(list);
    deliver({ ...note, count: list.length, native: canNative() && limiter.allow(`${note.title}\n${note.body}`) });
  }

  function tick() {
    timer = null;
    if (disposed || !pending.length) return;
    const wait = quietMs - (now() - lastAdd);
    if (wait > 0) { arm(wait); return; }
    if (isBusy() && !pending.some((i) => i.type === 'failed')) { arm(quietMs); return; }
    flush();
  }

  return {
    add(item) {
      if (disposed || !item || (item.type !== 'done' && item.type !== 'failed')) return;
      pending.push(item);
      if (pending.length > MAX_PENDING) pending = pending.slice(pending.length - MAX_PENDING);
      lastAdd = now();
      arm(quietMs);
    },
    pending: () => pending.length,
    dispose() {
      disposed = true;
      pending = [];
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}

module.exports = {
  MIN_RUN_MS, QUIET_MS, MAX_PER_MINUTE, DEDUPE_MS, MAX_PENDING,
  cleanLabel, formatDuration, coerceFlag, classifyFailure,
  createTracker, systemFailure, describe, createLimiter, createNotifier,
};
