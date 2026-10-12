// When settings.json is written (pure: no electron, no fs). Writes are debounced, but never held back longer
// than MAX_WAIT_MS after the first unsaved change, so a steady stream of changes still reaches the disk.
const DEBOUNCE_MS = 2000;
const MAX_WAIT_MS = 10000;

/** Milliseconds to wait before the next write, given when the data first became unsaved. Never negative. */
function nextDelay(firstDirtyAt, now, debounce = DEBOUNCE_MS, maxWait = MAX_WAIT_MS) {
  return Math.max(0, Math.min(debounce, firstDirtyAt + maxWait - now));
}

module.exports = { DEBOUNCE_MS, MAX_WAIT_MS, nextDelay };
