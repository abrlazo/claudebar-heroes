// Pure checks for the floating bubble: the badge reducer (main/bubble-state.js), the geometry and the click / drag
// gesture (main/bubble-geometry.js) and the settings coercion. Usage: npm run check   (exit code 1 if anything fails)

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req = createRequire(import.meta.url);
const S = req(path.join(root, 'src/main/bubble-state.js'));
const G = req(path.join(root, 'src/main/bubble-geometry.js'));
const W = req(path.join(root, 'src/main/window-visibility.js'));

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  bubble: ${name}${detail ? `  (${detail})` : ''}`); };

// ----- badge priority: all 16 combinations of ask / failed / done / running -----
{
  let wrong = '';
  for (let m = 0; m < 16; m++) {
    const ask = !!(m & 1); const fail = !!(m & 2); const done = !!(m & 4); const run = !!(m & 8);
    const b = S.createBadge();
    b.setWaiting(ask ? 2 : 0); b.latch({ failed: fail ? 3 : 0, done: done ? 4 : 0 }); b.setRunning(run);
    const v = b.view();
    const want = ask ? 'ask' : fail ? 'failed' : done ? 'done' : run ? 'running' : 'none';
    const count = ask ? 2 : fail ? 3 : done ? 4 : 0;
    if (v.badge !== want || v.count !== count) wrong += ` ${m}:${v.badge}/${v.count}`;
  }
  check('priority ask > failed > done > running > none for all 16 combinations', wrong === '', wrong);
}
{
  check('countLabel: none, 1..9, 9+', S.countLabel(0) === '' && S.countLabel(1) === '1' && S.countLabel(9) === '9' && S.countLabel(10) === '9+' && S.countLabel(999) === '9+' && S.countLabel(5000) === '9+');
  check('junk counts become 0', ['3', NaN, Infinity, -4, 2.5, null, undefined, {}].every((x) => S.cleanCount(x) === 0) && S.cleanCount(5000) === 999);
  const b = S.createBadge();
  b.latch({ done: 1 }); b.latch({ done: 2, failed: 1 });
  check('latched counts add up', b.view().badge === 'failed' && b.view().count === 1);
  b.setWaiting(1); b.setRunning(true);
  b.clearLatched();
  check('clearLatched keeps waiting and running', b.view().badge === 'ask' && b.view().count === 1);
  b.setWaiting(0);
  check('and what is left is running', b.view().badge === 'running' && b.view().count === 0);
  b.latch({ done: NaN, failed: 'x' });
  check('a junk latch changes nothing', b.view().badge === 'running');
  b.latch({ done: 500 }); b.latch({ done: 900 });
  check('counts are clamped at 999', b.view().count === 999);
  check('setRunning only takes a real true', (() => { const x = S.createBadge(); x.setRunning('yes'); return x.view().badge === 'none'; })());
}
{
  const p = S.payload({ badge: 'ask', count: 12 }, 'light');
  check('payload has exactly badge, label, theme', JSON.stringify(Object.keys(p)) === '["badge","label","theme"]' && p.badge === 'ask' && p.label === '9+' && p.theme === 'light');
  check('theme is coerced to dark or light', S.payload({ badge: 'none', count: 0 }, '<x>').theme === 'dark' && S.payload({ badge: 'none', count: 0 }, undefined).theme === 'dark');
  check('a bad badge is none, running has no label', S.payload({ badge: 'evil', count: 3 }, 'dark').badge === 'none' && S.payload({ badge: 'running', count: 3 }, 'dark').label === '' && S.payload(null, 'dark').badge === 'none');
  check('every label is empty, a digit or 9+ (the page checks the same)', [0, 1, 5, 9, 10, 50].every((n) => /^(\d|9\+)?$/.test(S.payload({ badge: 'done', count: n }, 'dark').label)));
}

// ----- positions -----
{
  const ok = (v) => G.cleanBubblePos(v);
  check('cleanBubblePos: junk, NaN, huge, arrays, strings -> null', [null, undefined, 5, 'x', [], [1, 2], {}, { x: 1 }, { x: NaN, y: 1 }, { x: 1, y: Infinity }, { x: 1e9, y: 1 }, { x: '1', y: 2 }].every((v) => ok(v) === null));
  check('cleanBubblePos rounds and keeps only x and y', JSON.stringify(ok({ x: 10.6, y: -3.2, evil: 1 })) === '{"x":11,"y":-3}');
  const one = [{ x: 0, y: 25, width: 1000, height: 700 }];
  check('clamp keeps a position inside the work area', JSON.stringify(G.clampBubblePos({ x: 100, y: 100 }, one)) === '{"x":100,"y":100}');
  check('clamp pulls it inside on every side (56 px square)', JSON.stringify(G.clampBubblePos({ x: -500, y: -500 }, one)) === '{"x":0,"y":25}' && JSON.stringify(G.clampBubblePos({ x: 5000, y: 5000 }, one)) === '{"x":944,"y":669}');
  const two = [{ x: 0, y: 0, width: 1000, height: 700 }, { x: 1000, y: 0, width: 800, height: 600 }];
  check('with two displays the one holding most of it wins', JSON.stringify(G.clampBubblePos({ x: 1010, y: 300 }, two)) === '{"x":1010,"y":300}' && JSON.stringify(G.clampBubblePos({ x: 1700, y: 590 }, two)) === '{"x":1700,"y":544}');
  check('between two displays it picks the one with more of it', JSON.stringify(G.clampBubblePos({ x: 990, y: 100 }, two)) === '{"x":1000,"y":100}');
  check('a removed display: the old spot is moved to the nearest remaining one', JSON.stringify(G.clampBubblePos({ x: 1500, y: 300 }, [two[0]])) === '{"x":944,"y":300}');
  check('isShown: far away is not shown, inside is', !G.isShown({ x: 99999, y: 99999 }, two) && G.isShown({ x: 10, y: 10 }, two));
  check('clamp with no display or junk position', G.clampBubblePos({ x: 3, y: 4 }, []).x === 3 && G.clampBubblePos('x', two) === null);
  const d = G.defaultBubblePos({ x: 100, y: 400 }, 560, 96, 8);
  check('default spot: the strip\'s bottom-right corner', d.x === 100 + 560 - 56 - 8 && d.y === 400 + 96 - 56 - 8, JSON.stringify(d));
}

// ----- the gesture -----
{
  const g = G.createGesture();
  g.press({ x: 100, y: 100 });
  g.move({ x: 104, y: 100 });
  check('4 px is still a click', g.release() === 'click');
  g.press({ x: 100, y: 100 });
  check('exactly 5 px is a click, more than 5 is a drag', g.move({ x: 105, y: 100 }).dragging === false && g.move({ x: 106, y: 100 }).dragging === true);
  check('move reports the offset from the press', (() => { const m = g.move({ x: 140, y: 90 }); return m.dx === 40 && m.dy === -10; })());
  g.move({ x: 100, y: 100 });
  check('dragging back to the start is still a drag', g.release() === 'drag');
  check('release without a press is none, and a second release too', g.release() === 'none');
  g.press({ x: 0, y: 0 }); g.move({ x: 50, y: 50 }); g.cancel();
  check('cancel forgets the gesture', g.release() === 'none' && !g.active());
  g.press({ x: 1, y: 1 });
  check('a new press after a drag starts clean', g.release() === 'click');
  g.press({ x: NaN, y: 0 });
  check('a press with a junk point is not a gesture', g.release() === 'none');
  check('move without a press is harmless', g.move({ x: 1, y: 1 }).dragging === false);
}

// ----- settings coercion (settings.js uses these two) -----
check('minimizeTo: only "tray" is tray, everything else the default bubble', W.coerceMode('tray') === 'tray' && ['bubble', 'x', 1, null, undefined, {}].every((v) => W.coerceMode(v) === 'bubble'));

process.exit(failed ? 1 : 0);
