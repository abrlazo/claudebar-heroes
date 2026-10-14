// Pure checks for the archive drawer's window layout (main/drawer-layout.js).
// Usage: npm run check   (exit code 1 if anything fails)

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DRAWER_W, DRAWER_GAP, DRAWER_EXTRA, PIPE_W, PIPE_GAP, PIPE_EXTRA, chooseDrawerMode, choosePanes, windowRect } = createRequire(import.meta.url)(path.join(root, 'src/main/drawer-layout.js'));

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

// ---- the workflow pipeline pane (choosePanes) ----
check('sizes: 280 wide pipeline + 8 px gap', PIPE_W === 280 && PIPE_GAP === 8 && PIPE_EXTRA === 288);
const panes = (x, a = area, drawerWanted = false, pipelineWanted = true, extra = {}) => choosePanes({ stripX: x, stripW: W, area: a, drawerWanted, pipelineWanted, ...extra });
const BR = 1920 - W - 8; // the default bottom-right spot
check('panes: nothing wanted -> nulls', JSON.stringify(panes(900, area, false, false)) === '{"drawer":null,"pipeline":null}');
check('panes: the drawer alone is exactly chooseDrawerMode', [0, 20, 100, 607, 608, 900, BR].every((x) => panes(x, area, true, false).drawer === mode(x) && panes(x, area, true, false).pipeline === null));
check('panes: bottom-right spot, drawer closed -> pipeline inline (never the left, that is the drawer\'s side)', panes(BR).pipeline === 'inline' && panes(BR).drawer === null);
check('panes: bottom-right spot, drawer opened (left) -> pipeline inline', (() => { const r = panes(BR, area, true); return r.drawer === 'left' && r.pipeline === 'inline'; })());
check('panes: centred spot, drawer left + pipeline right', (() => { const r = panes(680, area, true); return r.drawer === 'left' && r.pipeline === 'right'; })());
check('panes: centred spot, pipeline alone -> right', panes(680).pipeline === 'right');
check('panes: exactly 288 px on the right -> right, 287 -> inline', panes(1920 - W - 288).pipeline === 'right' && panes(1920 - W - 287).pipeline === 'inline');
check('panes: drawer on the right forces the pipeline inline', (() => {
  const a = { x: 0, y: 0, width: 1188, height: 800 }; // 20 left, 608 right: drawer right
  const wide = { x: 0, y: 0, width: 1188 + 288, height: 800 };
  const r1 = panes(20, a, true); const r2 = panes(400, { x: 0, y: 0, width: 400 + W + 608, height: 800 }, true);
  return r1.drawer === 'right' && r1.pipeline === 'inline' && r2.drawer === 'right' && r2.pipeline === 'inline' && panes(20, wide, true).pipeline === 'inline';
})());
check('panes: a narrow display -> overlay drawer and inline pipeline', (() => { const r = panes(100, { x: 0, y: 0, width: 800, height: 600 }, true); return r.drawer === 'overlay' && r.pipeline === 'inline'; })());
check('panes: a forced overlay drawer leaves the sides to the pipeline', (() => { const r = panes(680, area, true, true, { drawerForced: 'overlay' }); return r.drawer === 'overlay' && r.pipeline === 'right'; })());
check('panes: a second display is measured from its own edge', panes(1920 + 100, { x: 1920, y: 0, width: 1920, height: 1080 }).pipeline === 'right' && panes(1920 + 1920 - W - 10, { x: 1920, y: 0, width: 1920, height: 1080 }).pipeline === 'inline');

const pr = (over) => windowRect({ ...base, stripPos: sp, panelOpen: true, panelSide: 'above', drawerOpen: false, drawerMode: 'left', pipelineOpen: false, pipelineMode: 'right', ...over });
const plain = pr({});
check('rect: pipeline closed -> the plain panel window', plain.x === 1000 && plain.width === W);
const pl = pr({ pipelineOpen: true, pipelineMode: 'left' });
const prr = pr({ pipelineOpen: true, pipelineMode: 'right' });
const pi = pr({ pipelineOpen: true, pipelineMode: 'inline' });
check('rect: pipeline left keeps the right edge and the strip x', pl.x === 1000 - 288 && pl.width === W + 288 && pl.x + pl.width === plain.x + plain.width && pl.x + 288 === sp.x);
check('rect: pipeline right keeps the left edge', prr.x === 1000 && prr.width === W + 288);
check('rect: pipeline inline does not change the window', JSON.stringify(pi) === JSON.stringify(plain));
const both1 = pr({ drawerOpen: true, drawerMode: 'left', pipelineOpen: true, pipelineMode: 'right' });
check('rect: drawer left + pipeline right: both extras, the strip stays', both1.x === 1000 - 608 && both1.width === W + 608 + 288 && both1.x + 608 === sp.x);
const both2 = pr({ drawerOpen: true, drawerMode: 'right', pipelineOpen: true, pipelineMode: 'left' });
check('rect: drawer right + pipeline left: both extras, the strip stays', both2.x === 1000 - 288 && both2.width === W + 608 + 288 && both2.x + 288 === sp.x);
const both3 = pr({ drawerOpen: true, drawerMode: 'overlay', pipelineOpen: true, pipelineMode: 'left' });
check('rect: overlay drawer + pipeline left: only the pipeline grows', both3.x === 1000 - 288 && both3.width === W + 288);
const both4 = pr({ drawerOpen: true, drawerMode: 'left', pipelineOpen: true, pipelineMode: 'inline' });
check('rect: drawer left + pipeline inline: only the drawer grows', both4.x === 1000 - 608 && both4.width === W + 608);
const closedPanel = windowRect({ ...base, stripPos: sp, panelOpen: false, panelSide: 'above', drawerOpen: true, drawerMode: 'left', pipelineOpen: true, pipelineMode: 'left' });
check('rect: panel closed -> no growth for either pane', closedPanel.x === 1000 && closedPanel.width === W && closedPanel.height === H);
check('rect: y and height do not change with the pipeline', pl.y === plain.y && prr.y === plain.y && pl.height === plain.height && both1.height === plain.height);

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll drawer layout checks passed.');
process.exit(failed ? 1 : 0);
