// Pure core of "hide the app" (no electron import; tools/check-window-visibility.mjs tests it).
//
// The hidden state lives in main's memory only and is never saved: the app always starts visible. `request` is the one
// place that decides; main.js runs the returned effects, in order, on its single thread, so two quick calls cannot
// race (the second one finds the state changed and does nothing).

const ACTIONS = ['hide', 'show', 'toggle'];
// Who asked. Only used for the test log; an unknown value is recorded as 'unknown'.
const REASONS = ['button', 'settings', 'tray', 'shortcut', 'notification', 'second-instance', 'bubble'];
// Where a hidden app goes: a small floating bubble (default) or nowhere but the tray.
const MODES = ['bubble', 'tray'];

// The effect lists are computed per request: `show-bubble` is part of a hide only when the bubble is the handle.
const HIDE_EFFECTS = ['stop-drag', 'close-panel', 'hide-window', 'notify-renderer'];
const HIDE_BUBBLE_EFFECTS = ['stop-drag', 'close-panel', 'hide-window', 'show-bubble', 'notify-renderer'];
// The bubble goes away BEFORE the strip appears, so the two are never on screen together. `hide-bubble` is always
// part of a show: the mode can change while hidden, and hiding a bubble that is not up does nothing.
const SHOW_EFFECTS = ['place', 'hide-bubble', 'show-window', 'reassert', 'notify-renderer'];

const coerceMode = (value) => (value === 'tray' ? 'tray' : 'bubble');

/**
 * Hiding needs a way back. In 'tray' mode that is the tray icon (`trayOk`); in 'bubble' mode it is the tray icon OR a
 * usable bubble (`bubbleOk`). Without one, hiding is refused (showing is always allowed, so a handle that disappears
 * later never traps the window). `canHide` is the old name of `trayOk`.
 */
function createVisibility({ canHide = false, trayOk = canHide, bubbleOk = false, mode = 'bubble' } = {}) {
  let hidden = false;
  let tray = trayOk === true;
  let bubble = bubbleOk === true;
  let where = coerceMode(mode);

  const usesBubble = () => where === 'bubble' && bubble;
  const allowed = () => (where === 'tray' ? tray : tray || bubble);

  return {
    hidden: () => hidden,
    canHide: allowed,
    usesBubble,
    mode: () => where,
    setTray(value) { tray = value === true; },
    setCanHide(value) { tray = value === true; },
    setBubble(value) { bubble = value === true; },
    /** Anything but 'bubble' / 'tray' is ignored. */
    setMode(value) { if (MODES.includes(value)) where = value; },
    /** The window turned out to be shown or hidden by something else: follow reality before a show request. */
    sync(visible) { hidden = visible !== true; },
    /**
     * @returns {{ changed: boolean, hidden: boolean, effects: string[], refused?: string, action: string, reason: string }}
     */
    request(action, reason) {
      const why = REASONS.includes(reason) ? reason : 'unknown';
      if (!ACTIONS.includes(action)) return { changed: false, hidden, effects: [], refused: 'bad-action', action: String(action), reason: why };
      const wanted = action === 'toggle' ? (hidden ? 'show' : 'hide') : action;
      if (wanted === 'hide') {
        if (hidden) return { changed: false, hidden, effects: [], action: wanted, reason: why };
        if (!allowed()) return { changed: false, hidden, effects: [], refused: 'no-tray', action: wanted, reason: why };
        hidden = true;
        return { changed: true, hidden, effects: [...(usesBubble() ? HIDE_BUBBLE_EFFECTS : HIDE_EFFECTS)], action: wanted, reason: why };
      }
      if (!hidden) return { changed: false, hidden, effects: [], action: wanted, reason: why };
      hidden = false;
      return { changed: true, hidden, effects: [...SHOW_EFFECTS], action: wanted, reason: why };
    },
  };
}

/** The tray menu item shows what it will do. */
const trayLabel = (hidden) => (hidden ? 'Show' : 'Hide');

module.exports = { ACTIONS, REASONS, MODES, HIDE_EFFECTS, HIDE_BUBBLE_EFFECTS, SHOW_EFFECTS, coerceMode, createVisibility, trayLabel };
