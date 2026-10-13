// Pure core of the floating bubble's badge (no electron import; tools/check-bubble.mjs tests it).
//
// Main owns the badge; the bubble page only draws what main sends. Priority: ask > failed > done > running > none.
// `ask` and `running` follow the live runs; `failed` and `done` are LATCHED (counts add up) until the strip is shown.

const BADGES = ['ask', 'failed', 'done', 'running', 'none'];
const MAX_COUNT = 999;

/** Integers only, 0..999; anything else is 0. */
const cleanCount = (n) => (Number.isInteger(n) ? Math.max(0, Math.min(n, MAX_COUNT)) : 0);

/** '' for none, '1'..'9', '9+' above that. */
function countLabel(n) {
  const c = cleanCount(n);
  if (c <= 0) return '';
  return c > 9 ? '9+' : String(c);
}

const coerceTheme = (theme) => (theme === 'light' ? 'light' : 'dark');

function createBadge() {
  let waiting = 0;
  let running = false;
  let done = 0;
  let failed = 0;
  return {
    setWaiting(n) { waiting = cleanCount(n); },
    setRunning(on) { running = on === true; },
    /** Adds the counts of one delivered notification. */
    latch({ done: d = 0, failed: f = 0 } = {}) {
      done = cleanCount(done + cleanCount(d));
      failed = cleanCount(failed + cleanCount(f));
    },
    /** The strip was shown: the finished / failed marks are seen. Waiting requests and running work are not touched. */
    clearLatched() { done = 0; failed = 0; },
    view() {
      if (waiting > 0) return { badge: 'ask', count: waiting };
      if (failed > 0) return { badge: 'failed', count: failed };
      if (done > 0) return { badge: 'done', count: done };
      if (running) return { badge: 'running', count: 0 };
      return { badge: 'none', count: 0 };
    },
  };
}

/** What goes to the bubble page: three fixed-shape fields, never text from a run. */
function payload(view, theme) {
  const badge = view && BADGES.includes(view.badge) ? view.badge : 'none';
  return { badge, label: badge === 'none' || badge === 'running' ? '' : countLabel(view.count), theme: coerceTheme(theme) };
}

module.exports = { BADGES, MAX_COUNT, cleanCount, countLabel, coerceTheme, createBadge, payload };
