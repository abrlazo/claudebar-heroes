// Pure checks for the archive drawer's window layout (main/drawer-layout.js).
// Usage: npm run check   (exit code 1 if anything fails)

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { DRAWER_W, DRAWER_GAP, DRAWER_EXTRA, chooseDrawerMode, windowRect } = createRequire(import.meta.url)(path.join(root, 'src/main/drawer-layout.js'));

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

console.log(failed ? `\n${failed} check(s) failed.` : '\nAll drawer layout checks passed.');
process.exit(failed ? 1 : 0);
