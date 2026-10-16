// Pure geometry and gesture rules of the floating bubble (no electron import; tools/check-bubble.mjs tests it).

const BUBBLE_SIZE = 56;
const DRAG_THRESHOLD = 5;
const LIMIT = 100000;

/** A saved position: an object with two finite numbers within +-100000, rounded; anything else is null. */
function cleanBubblePos(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { x, y } = raw;
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) > LIMIT || Math.abs(y) > LIMIT) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

const overlap = (pos, a) => {
  const w = Math.min(pos.x + BUBBLE_SIZE, a.x + a.width) - Math.max(pos.x, a.x);
  const h = Math.min(pos.y + BUBBLE_SIZE, a.y + a.height) - Math.max(pos.y, a.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/** True when some work area shows at least half of the bubble. */
const isShown = (pos, areas) => areas.some((a) => overlap(pos, a) >= (BUBBLE_SIZE * BUBBLE_SIZE) / 2);

/**
 * Keeps the bubble inside the work area (not under the dock or taskbar) that holds most of it, else the nearest one
 * (by distance between centres). With no work area the position is returned unchanged.
 */
function clampBubblePos(pos, areas) {
  const p = cleanBubblePos(pos);
  if (!p || !Array.isArray(areas) || !areas.length) return p;
  let best = areas[0];
  let bestOverlap = -1;
  let bestDist = Infinity;
  const cx = p.x + BUBBLE_SIZE / 2;
  const cy = p.y + BUBBLE_SIZE / 2;
  for (const a of areas) {
    const o = overlap(p, a);
    const d = Math.hypot(a.x + a.width / 2 - cx, a.y + a.height / 2 - cy);
    if (o > bestOverlap || (o === bestOverlap && d < bestDist)) { best = a; bestOverlap = o; bestDist = d; }
  }
  return {
    x: Math.round(Math.min(Math.max(p.x, best.x), best.x + Math.max(0, best.width - BUBBLE_SIZE))),
    y: Math.round(Math.min(Math.max(p.y, best.y), best.y + Math.max(0, best.height - BUBBLE_SIZE))),
  };
}

/** Never dragged: the bottom-right corner of the strip's spot, so the hero shrinks into its place. */
function defaultBubblePos(stripPos, stripW, stripH, margin = 8) {
  return { x: Math.round(stripPos.x + stripW - BUBBLE_SIZE - margin), y: Math.round(stripPos.y + stripH - BUBBLE_SIZE - margin) };
}

/**
 * Click or drag, decided by main from the cursor (the page only reports press / release). Once the cursor has moved
 * more than `threshold` px from the press it is a drag for good, even if it comes back.
 */
function createGesture({ threshold = DRAG_THRESHOLD } = {}) {
  let start = null;
  let dragging = false;
  return {
    press(point) {
      start = point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : null;
      dragging = false;
    },
    move(point) {
      if (!start || !point) return { dragging: false, dx: 0, dy: 0 };
      const dx = point.x - start.x;
      const dy = point.y - start.y;
      if (!dragging && Math.hypot(dx, dy) > threshold) dragging = true;
      return { dragging, dx, dy };
    },
    active: () => start !== null,
    release() {
      const result = start === null ? 'none' : dragging ? 'drag' : 'click';
      start = null;
      dragging = false;
      return result;
    },
    cancel() { start = null; dragging = false; },
  };
}

module.exports = { BUBBLE_SIZE, DRAG_THRESHOLD, cleanBubblePos, clampBubblePos, isShown, defaultBubblePos, createGesture };
