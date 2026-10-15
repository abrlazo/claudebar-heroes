// Pure layout of the app's window (no electron import; tools/check-drawer.mjs tests it).
//
// Fixed mode (the default): the OS window rectangle is a function of the strip's position and the display ONLY. It is big
// enough for the panel on its chosen side and, in left/right drawer mode, for the archive drawer too, so opening or closing
// the panel or the drawer never resizes or moves the window (that is pure CSS in the renderer). The window is re-laid-out
// only at stable moments (drag end, Reset Position, show, display change, panel height change, startup).
// Fit mode (`fixed: false`: Linux, or CBH_WINDOW_FIT=1): the old behaviour, the window grows with the open panel / drawer.
const { DRAWER_W, DRAWER_GAP, DRAWER_EXTRA, chooseDrawerMode, windowRect } = require('./drawer-layout');

const MAX_PANEL = 1000; // the largest panel height + gap (same bound as settings.panelHeight)

/**
 * { stripPos, stripW, stripH, area, panelHeight, fixed, forceOverlay }
 * plus, for fit mode only: { panelOpen, panelSide, drawerOpen, drawerMode }.
 * Returns { fixed, rect, side, mode, panelH, maxPanelH, stripOffset }. `stripOffset` is where the strip's top-left sits
 * inside the window; `panelH` is the panel height + gap to show, `maxPanelH` the most the window can hold.
 */
function computeLayout(o) {
  const { stripPos, stripW, stripH, area, panelHeight } = o;
  if (!o.fixed) {
    const side = o.panelSide || 'above';
    const mode = o.drawerMode || 'left';
    const rect = windowRect({
      stripPos, stripW, stripH, panelOpen: !!o.panelOpen, panelSide: side, panelHeight, drawerOpen: !!o.drawerOpen, drawerMode: mode,
    });
    return { fixed: false, rect, side, mode, panelH: panelHeight, maxPanelH: MAX_PANEL, stripOffset: { x: stripPos.x - rect.x, y: stripPos.y - rect.y } };
  }
  const roomAbove = Math.max(0, stripPos.y - area.y);
  const roomBelow = Math.max(0, area.y + area.height - (stripPos.y + stripH));
  // Never taller than the room the display has, so the permanent window stays inside the work area.
  const panelH = Math.round(Math.min(panelHeight, MAX_PANEL, Math.max(roomAbove, roomBelow)));
  const side = roomAbove >= panelH ? 'above' : 'below';
  const sideRoom = side === 'above' ? roomAbove : roomBelow;
  // The extent depends on the room, not on panelHeight, so changing the height later does not resize the window.
  const extent = Math.round(Math.max(panelH, Math.min(MAX_PANEL, sideRoom)));
  const mode = o.forceOverlay ? 'overlay' : chooseDrawerMode(stripPos.x, stripW, area);
  const wide = mode !== 'overlay';
  const rect = {
    x: stripPos.x - (mode === 'left' ? DRAWER_EXTRA : 0),
    y: side === 'above' ? stripPos.y - extent : stripPos.y,
    width: stripW + (wide ? DRAWER_EXTRA : 0),
    height: stripH + extent,
  };
  return { fixed: true, rect, side, mode, panelH, maxPanelH: extent, stripOffset: { x: stripPos.x - rect.x, y: stripPos.y - rect.y } };
}

function sameRect(a, b) {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/** Screen rectangles that take the mouse: the strip, and the panel and drawer when they are open. */
function interactiveRects({ stripPos, stripW, stripH, side, panelH, mode, panelOpen, drawerOpen }) {
  const rects = [{ x: stripPos.x, y: stripPos.y, width: stripW, height: stripH }];
  if (!panelOpen) return rects;
  const height = Math.max(0, panelH - DRAWER_GAP);
  const y = side === 'above' ? stripPos.y - panelH : stripPos.y + stripH + DRAWER_GAP;
  rects.push({ x: stripPos.x, y, width: stripW, height });
  if (drawerOpen) {
    if (mode === 'left') rects.push({ x: stripPos.x - DRAWER_EXTRA, y, width: DRAWER_W, height });
    else if (mode === 'right') rects.push({ x: stripPos.x + stripW + DRAWER_GAP, y, width: DRAWER_W, height });
  }
  return rects; // overlay: the drawer lies inside the panel's rectangle
}

/** True if the point is inside (or within `slack` px of) any rectangle; the edges count as inside. */
function pointInRects(p, rects, slack = 0) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  return rects.some((r) => p.x >= r.x - slack && p.x <= r.x + r.width + slack && p.y >= r.y - slack && p.y <= r.y + r.height + slack);
}

module.exports = { MAX_PANEL, computeLayout, sameRect, interactiveRects, pointInRects };
