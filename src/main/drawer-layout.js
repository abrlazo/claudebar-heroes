// Pure geometry for the archive drawer (no electron import; tools/check-drawer.mjs tests it).
// The drawer opens beside the chat panel. The window widens only while it is open, and `windowPos`
// stays the strip's top-left, so the strip never moves: the drawer grows the window to the LEFT of the
// strip when there is room, else to the RIGHT, else it overlays the panel (the window does not grow).
const DRAWER_W = 600;
const DRAWER_GAP = 8;
const DRAWER_EXTRA = DRAWER_W + DRAWER_GAP;

/** 'left' | 'right' | 'overlay' for a strip at stripX (width stripWidth) on a display with work area `area`. */
function chooseDrawerMode(stripX, stripWidth, area) {
  if (stripX - area.x >= DRAWER_EXTRA) return 'left';
  if (area.x + area.width - (stripX + stripWidth) >= DRAWER_EXTRA) return 'right';
  return 'overlay';
}

/** The window rectangle. A drawer counts as open only while the panel is. */
function windowRect({ stripPos, stripW, stripH, panelOpen, panelSide, panelHeight, drawerOpen, drawerMode }) {
  const grows = !!(drawerOpen && panelOpen && drawerMode !== 'overlay');
  const left = grows && drawerMode === 'left';
  return {
    x: stripPos.x - (left ? DRAWER_EXTRA : 0),
    y: panelOpen && panelSide === 'above' ? stripPos.y - panelHeight : stripPos.y,
    width: stripW + (grows ? DRAWER_EXTRA : 0),
    height: panelOpen ? stripH + panelHeight : stripH,
  };
}

module.exports = { DRAWER_W, DRAWER_GAP, DRAWER_EXTRA, chooseDrawerMode, windowRect };
