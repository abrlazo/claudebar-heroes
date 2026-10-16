// Pure checks for the archive drawer's window layout (main/drawer-layout.js) and the fixed window layout (main/window-layout.js).
// Usage: npm run check   (exit code 1 if anything fails)

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const { DRAWER_W, DRAWER_GAP, DRAWER_EXTRA, chooseDrawerMode, windowRect } = req(path.join(root, 'src/main/drawer-layout.js'));
const { MAX_PANEL, computeLayout, sameRect, interactiveRects, pointInRects } = req(path.join(root, 'src/main/window-layout.js'));

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

const W = 560; const H = 96; const PH = 500;
const area = { x: 0, y: 25, width: 1920, height: 1000 };
const mode = (x, a = area) => chooseDrawerMode(x, W, a);

check('sizes: 600 wide drawer + 8 px gap', DRAWER_W === 600 && DRAWER_GAP === 8 && DRAWER_EXTRA === 608);
check('mode: room on the left -> left', mode(900) === 'left');
check('mode: exactly 608 px on the left -> left', mode(608) === 'left');
check('mode: 607 px on the left, room on the right -> right', mode(607) === 'right');
const narrow = { x: 0, y: 0, width: 1188, height: 800 }; // 20 px left of the strip, 608 px right of it
check('mode: left too small and the right fits exactly -> right', mode(20, narrow) === 'right');
check('mode: neither side fits (right 1 px short) -> overlay', mode(20, { ...narrow, width: 1187 }) === 'overlay');
check('mode: a narrow display -> overlay', chooseDrawerMode(100, W, { x: 0, y: 0, width: 800, height: 600 }) === 'overlay');
check('mode: a second display at a positive offset is measured from its own edge', chooseDrawerMode(2000 + 100, W, { x: 1920, y: 0, width: 1920, height: 1080 }) === 'right' && chooseDrawerMode(1920 + 700, W, { x: 1920, y: 0, width: 1920, height: 1080 }) === 'left');
check('mode: a display at a negative offset', chooseDrawerMode(-1800, W, { x: -1920, y: 0, width: 1920, height: 1080 }) === 'right');

const base = { stripW: W, stripH: H, panelHeight: PH };
const sp = { x: 1000, y: 700 };
for (const side of ['above', 'below']) {
  const closed = windowRect({ ...base, stripPos: sp, panelOpen: true, panelSide: side, drawerOpen: false, drawerMode: 'left' });
  const left = windowRect({ ...base, stripPos: sp, panelOpen: true, panelSide: side, drawerOpen: true, drawerMode: 'left' });
  const right = windowRect({ ...base, stripPos: sp, panelOpen: true, panelSide: side, drawerOpen: true, drawerMode: 'right' });
  const over = windowRect({ ...base, stripPos: sp, panelOpen: true, panelSide: side, drawerOpen: true, drawerMode: 'overlay' });
  check(`${side}: drawer closed -> the plain panel window`, closed.x === 1000 && closed.width === W && closed.height === H + PH && closed.y === (side === 'above' ? 200 : 700));
  check(`${side}: left mode keeps the right edge and the strip x`, left.x + left.width === closed.x + closed.width && left.x === closed.x - 608 && left.width === W + 608 && (left.x + 608) === sp.x);
  check(`${side}: right mode keeps the left edge`, right.x === closed.x && right.width === W + 608);
  check(`${side}: overlay mode does not change the window`, JSON.stringify(over) === JSON.stringify(closed));
  check(`${side}: y and height do not change with the drawer`, left.y === closed.y && right.y === closed.y && left.height === closed.height && right.height === closed.height);
}
const strip = windowRect({ ...base, stripPos: sp, panelOpen: false, panelSide: 'above', drawerOpen: false, drawerMode: 'left' });
check('panel closed: just the strip', strip.x === 1000 && strip.y === 700 && strip.width === W && strip.height === H);
const stray = windowRect({ ...base, stripPos: sp, panelOpen: false, panelSide: 'above', drawerOpen: true, drawerMode: 'left' });
check('a drawer cannot be open without the panel (window stays the strip)', JSON.stringify(stray) === JSON.stringify(strip));


// ----- Fixed window layout (main/window-layout.js) -----
const displays = {
  big: { x: 0, y: 25, width: 1920, height: 1000 },
  second: { x: 1920, y: 0, width: 2560, height: 1440 },
  negative: { x: -1920, y: 0, width: 1920, height: 1080 },
  laptop: { x: 0, y: 25, width: 1366, height: 743 },
  small: { x: 0, y: 0, width: 800, height: 600 },
};
const inside = (r, a) => r.x >= a.x && r.y >= a.y && r.x + r.width <= a.x + a.width && r.y + r.height <= a.y + a.height;
const spots = (a) => {
  const fx = (f) => Math.round(a.x + (a.width - W) * f);
  const fy = (f) => Math.round(a.y + (a.height - H) * f);
  return [[0, 0], [0, 1], [1, 0], [1, 1], [0.5, 0.5], [0.5, 0], [0.5, 1], [0.1, 0.9], [0.9, 0.1]].map(([x, y]) => ({ x: fx(x), y: fy(y) }));
};
let allInside = true; let allExact = true; let allOrdered = true; let allWidth = true; let allSameRect = true; let combos = 0; const seen = new Set();
for (const [name, area] of Object.entries(displays)) {
  for (const stripPos of spots(area)) {
    for (const panelHeight of [300, 500, 1000]) {
      for (const forceOverlay of [false, true]) {
        const l = computeLayout({ stripPos, stripW: W, stripH: H, area, panelHeight, fixed: true, forceOverlay });
        // an open panel / drawer must not change anything: the function takes no flags, but pass some to prove it
        const o = computeLayout({ stripPos, stripW: W, stripH: H, area, panelHeight, fixed: true, forceOverlay, panelOpen: true, drawerOpen: true, panelSide: 'below', drawerMode: 'right' });
        combos++;
        seen.add(`${l.side}/${l.mode}`);
        if (!sameRect(l.rect, o.rect) || l.side !== o.side || l.mode !== o.mode) allSameRect = false;
        if (!inside(l.rect, area)) { allInside = false; console.log('  outside', name, stripPos, panelHeight, JSON.stringify(l.rect)); }
        if (l.rect.x + l.stripOffset.x !== stripPos.x || l.rect.y + l.stripOffset.y !== stripPos.y) allExact = false;
        if (!(l.panelH <= l.maxPanelH && l.maxPanelH >= l.panelH && l.maxPanelH <= MAX_PANEL && l.panelH <= panelHeight)) allOrdered = false;
        if (l.rect.width !== (l.mode === 'overlay' ? W : W + 608) || l.rect.height !== H + l.maxPanelH) allWidth = false;
      }
    }
  }
}
check(`fixed: ${combos} combinations (5 displays, 9 spots, 3 heights, forced overlay or not)`, combos === 5 * 9 * 3 * 2);
check('fixed: the rect (and side, mode) never depends on an open flag', allSameRect);
check('fixed: the window always lies inside the work area', allInside);
check('fixed: the strip lands on stripPos exactly (rect + stripOffset)', allExact);
check('fixed: panelH <= extent <= 1000 and panelH <= the setting', allOrdered);
check('fixed: width is 560 (overlay) or 1168, height is the strip + the extent', allWidth);
check('fixed: all of above/below and left/right/overlay occur', ['above/left', 'above/right', 'above/overlay', 'below/left', 'below/right', 'below/overlay'].every((k) => seen.has(k)), [...seen].join(' '));

const bigArea = displays.big;
const cornerSpot = { x: bigArea.x + bigArea.width - W - 8, y: bigArea.y + bigArea.height - H - 8 }; // the default spot
const corner = computeLayout({ stripPos: cornerSpot, stripW: W, stripH: H, area: bigArea, panelHeight: 500, fixed: true });
check('fixed: the bottom-right default spot gives above + left', corner.side === 'above' && corner.mode === 'left' && corner.rect.width === 1168);
check('fixed: that window ends exactly at the strip\'s right and bottom edges', corner.rect.x + corner.rect.width === cornerSpot.x + W && corner.rect.y + corner.rect.height === cornerSpot.y + H);
check('fixed: the extent is the room above (up to 1000), not the setting', corner.maxPanelH === cornerSpot.y - bigArea.y && corner.maxPanelH > 500 && corner.panelH === 500);
const resized = computeLayout({ stripPos: cornerSpot, stripW: W, stripH: H, area: bigArea, panelHeight: 700, fixed: true });
check('fixed: changing the panel height later does not change the window', sameRect(corner.rect, resized.rect) && resized.panelH === 700);
const top = computeLayout({ stripPos: { x: 900, y: bigArea.y + 10 }, stripW: W, stripH: H, area: bigArea, panelHeight: 500, fixed: true });
check('fixed: a strip near the top opens below', top.side === 'below' && top.rect.y === bigArea.y + 10 && top.stripOffset.y === 0);
const short = computeLayout({ stripPos: { x: 700, y: 300 }, stripW: W, stripH: H, area: { x: 0, y: 0, width: 1920, height: 600 }, panelHeight: 1000, fixed: true });
check('fixed: a display shorter than the setting clamps the panel to the room', short.panelH <= 600 - H && short.rect.y >= 0 && short.rect.y + short.rect.height <= 600);
check('fixed: sameRect', sameRect(corner.rect, { ...corner.rect }) && !sameRect(corner.rect, { ...corner.rect, x: 1 }) && !sameRect(null, corner.rect));

// Fit mode (Linux, CBH_WINDOW_FIT=1): the old rectangles, from the open flags.
for (const side of ['above', 'below']) {
  const fit = (panelOpen, drawerOpen, drawerMode) => computeLayout({ stripPos: sp, stripW: W, stripH: H, area, panelHeight: PH, fixed: false, panelOpen, panelSide: side, drawerOpen, drawerMode });
  const c = fit(false, false, 'left').rect;
  const p = fit(true, false, 'left').rect;
  const dl = fit(true, true, 'left');
  check(`fit ${side}: closed is the strip, open adds the panel`, c.width === W && c.height === H && c.y === 700 && p.height === H + PH && p.y === (side === 'above' ? 200 : 700));
  check(`fit ${side}: the left drawer widens to the left and keeps the strip put`, dl.rect.width === W + 608 && dl.rect.x + dl.stripOffset.x === sp.x && dl.rect.x === sp.x - 608);
  check(`fit ${side}: overlay does not widen`, sameRect(fit(true, true, 'overlay').rect, p) && fit(true, false, 'left').fixed === false && fit(true, false, 'left').maxPanelH === MAX_PANEL);
}

// Where the mouse is taken.
const rectsAbove = interactiveRects({ stripPos: sp, stripW: W, stripH: H, side: 'above', panelH: PH, mode: 'left', panelOpen: true, drawerOpen: true });
check('rects: strip + panel + drawer when all are open', rectsAbove.length === 3);
check('rects: only the strip when the panel is closed (a drawer without a panel counts for nothing)', interactiveRects({ stripPos: sp, stripW: W, stripH: H, side: 'above', panelH: PH, mode: 'left', panelOpen: false, drawerOpen: true }).length === 1);
check('rects: overlay adds no extra rectangle', interactiveRects({ stripPos: sp, stripW: W, stripH: H, side: 'below', panelH: PH, mode: 'overlay', panelOpen: true, drawerOpen: true }).length === 2);
check('pointInRects: inside, on the edge', pointInRects({ x: 1100, y: 740 }, rectsAbove) && pointInRects({ x: 1000, y: 700 }, rectsAbove) && pointInRects({ x: 1560, y: 796 }, rectsAbove));
check('pointInRects: the drawer on the left and the panel above count', pointInRects({ x: 600, y: 400 }, rectsAbove) && pointInRects({ x: 1200, y: 300 }, rectsAbove));
check('pointInRects: outside, the gap above the strip row, and slack', !pointInRects({ x: 1565, y: 740 }, rectsAbove) && pointInRects({ x: 1563, y: 740 }, rectsAbove, 4) && !pointInRects({ x: 1565, y: 740 }, rectsAbove, 4) && !pointInRects({ x: 1100, y: 900 }, rectsAbove, 4));
check('pointInRects: no point or no rectangle is outside', !pointInRects(null, rectsAbove) && !pointInRects({ x: NaN, y: 1 }, rectsAbove) && !pointInRects({ x: 1, y: 1 }, []));

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll drawer layout checks passed.');
process.exit(failed ? 1 : 0);
