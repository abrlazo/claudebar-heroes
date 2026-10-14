// Pure geometry for the panes that open beside the chat panel: the archive drawer and the workflow pipeline pane
// (no electron import; tools/check-drawer.mjs tests it).
// The window widens only while a pane is open, and `windowPos` stays the strip's top-left, so the strip never moves:
// the drawer grows the window to the LEFT of the strip when there is room, else to the RIGHT, else it lies over the panel
// ('overlay'); the pipeline only ever grows it to the RIGHT, else it sits inside the panel ('inline'); neither of those grows it.
const DRAWER_W = 600;
const DRAWER_GAP = 8;
const DRAWER_EXTRA = DRAWER_W + DRAWER_GAP;
const PIPE_W = 280;
const PIPE_GAP = 8;
const PIPE_EXTRA = PIPE_W + PIPE_GAP;

/** 'left' | 'right' | 'overlay' for a strip at stripX (width stripWidth) on a display with work area `area`. */
function chooseDrawerMode(stripX, stripWidth, area) {
  if (stripX - area.x >= DRAWER_EXTRA) return 'left';
  if (area.x + area.width - (stripX + stripWidth) >= DRAWER_EXTRA) return 'right';
  return 'overlay';
}

/**
 * Both panes at once. The drawer is the user's action and keeps `chooseDrawerMode`; the pipeline is automatic and always
 * belongs on the RIGHT (the drawer's side is the left): right when there is room and the drawer is not there, else inline. `drawerForced` (a test seam of main)
 * replaces the drawer's own choice. Returns { drawer, pipeline }, null for a pane that is not wanted.
 */
function choosePanes({ stripX, stripW, area, drawerWanted, pipelineWanted, drawerForced }) {
  const drawer = drawerWanted ? (drawerForced || chooseDrawerMode(stripX, stripW, area)) : null;
  let pipeline = null;
  if (pipelineWanted) {
    const freeRight = area.x + area.width - (stripX + stripW);
    pipeline = drawer !== 'right' && freeRight >= PIPE_EXTRA ? 'right' : 'inline';
  }
  return { drawer, pipeline };
}

/** The window rectangle. A pane counts as open only while the panel is. */
function windowRect({ stripPos, stripW, stripH, panelOpen, panelSide, panelHeight, drawerOpen, drawerMode, pipelineOpen, pipelineMode }) {
  const drawerGrows = !!(drawerOpen && panelOpen && drawerMode !== 'overlay');
  const pipeGrows = !!(pipelineOpen && panelOpen && (pipelineMode === 'left' || pipelineMode === 'right'));
  const leftExtra = (drawerGrows && drawerMode === 'left' ? DRAWER_EXTRA : 0) + (pipeGrows && pipelineMode === 'left' ? PIPE_EXTRA : 0);
  return {
    x: stripPos.x - leftExtra,
    y: panelOpen && panelSide === 'above' ? stripPos.y - panelHeight : stripPos.y,
    width: stripW + (drawerGrows ? DRAWER_EXTRA : 0) + (pipeGrows ? PIPE_EXTRA : 0),
    height: panelOpen ? stripH + panelHeight : stripH,
  };
}

module.exports = { DRAWER_W, DRAWER_GAP, DRAWER_EXTRA, PIPE_W, PIPE_GAP, PIPE_EXTRA, chooseDrawerMode, choosePanes, windowRect };
