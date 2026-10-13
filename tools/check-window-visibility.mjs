// Pure checks for the hide / show rules (main/window-visibility.js). Usage: npm run check   (exit code 1 if anything fails)

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = createRequire(import.meta.url)(path.join(root, 'src/main/window-visibility.js'));

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  window: ${name}${detail ? `  (${detail})` : ''}`); };
const idx = (list, name) => list.indexOf(name);

{
  const v = W.createVisibility({ canHide: true });
  check('starts visible', v.hidden() === false);
  const r = v.request('hide', 'button');
  check('hide from visible changes state', r.changed && r.hidden && v.hidden() && !r.refused);
  check('tray mode / tray only: hide effects are ordered: stop-drag, close-panel, hide-window, notify-renderer',
    r.effects.join() === 'stop-drag,close-panel,hide-window,notify-renderer', r.effects.join());
  check('the panel closes before the window hides', idx(r.effects, 'close-panel') < idx(r.effects, 'hide-window') && idx(r.effects, 'stop-drag') < idx(r.effects, 'close-panel'));
  const again = v.request('hide', 'button');
  check('hide twice: the second is a no-op without effects', !again.changed && again.effects.length === 0 && again.hidden && !again.refused);
  const s = v.request('show', 'tray');
  check('show from hidden changes state', s.changed && !s.hidden && !v.hidden());
  check('show effects: place, hide-bubble BEFORE show-window, then reassert, then notify', s.effects.join() === 'place,hide-bubble,show-window,reassert,notify-renderer', s.effects.join());
  const s2 = v.request('show', 'tray');
  check('show twice: the second is a no-op', !s2.changed && s2.effects.length === 0);
  const t1 = v.request('toggle', 'tray');
  const t2 = v.request('toggle', 'tray');
  check('toggle flips both ways', t1.changed && t1.hidden && t1.action === 'hide' && t2.changed && !t2.hidden && t2.action === 'show');
  check('returned effect lists are copies (callers cannot change the rules)', (() => { const e = v.request('hide', 'tray').effects; e.length = 0; v.request('show', 'tray'); return v.request('hide', 'tray').effects.length === 4; })());
}
{
  const v = W.createVisibility({ canHide: false });
  const r = v.request('hide', 'button');
  check('hide without a tray is refused, no effects, state unchanged', r.refused === 'no-tray' && !r.changed && r.effects.length === 0 && !v.hidden());
  const t = v.request('toggle', 'tray');
  check('toggle without a tray does not hide either', t.refused === 'no-tray' && !v.hidden());
  check('show without a tray is a harmless no-op while visible', !v.request('show', 'tray').refused);
}
{
  const v = W.createVisibility({ canHide: true });
  v.request('hide', 'button');
  v.setCanHide(false);
  const s = v.request('show', 'second-instance');
  check('losing the tray while hidden does not trap the window: show still works', s.changed && !s.hidden && s.effects.length === 5);
  check('and hiding is refused again', v.request('hide', 'button').refused === 'no-tray');
  check('setCanHide only takes a real true', (() => { v.setCanHide('yes'); return v.canHide() === false; })());
}
{
  const v = W.createVisibility({ canHide: true });
  check('an unknown reason is recorded as unknown', v.request('hide', '<script>').reason === 'unknown' && v.request('show', undefined).reason === 'unknown');
  const bad = v.request('explode', 'button');
  check('an unknown action is refused with no effects', bad.refused === 'bad-action' && bad.effects.length === 0 && !bad.changed);
  check('every listed reason is accepted as itself', W.REASONS.every((r) => v.request('toggle', r).reason === r));
}
{
  const v = W.createVisibility({ canHide: true });
  v.request('hide', 'button');
  v.sync(true);
  check('sync(true) follows a window shown by something else, so a later show can run again', !v.hidden() && v.request('hide', 'tray').changed);
  v.sync(false);
  check('sync(false) marks it hidden', v.hidden());
  check('createVisibility() with no argument cannot hide', W.createVisibility().request('hide', 'button').refused === 'no-tray');
}
check('trayLabel says what the item will do', W.trayLabel(true) === 'Show' && W.trayLabel(false) === 'Hide');

// ----- the bubble: modes, canHide truth table, effects -----
{
  const can = (o) => W.createVisibility(o).canHide();
  check('bubble mode: tray only / bubble only / both / neither', can({ trayOk: true, mode: 'bubble' }) && can({ bubbleOk: true, mode: 'bubble' }) && can({ trayOk: true, bubbleOk: true, mode: 'bubble' }) && !can({ mode: 'bubble' }));
  check('tray mode: needs the tray, a bubble does not help', can({ trayOk: true, mode: 'tray' }) && !can({ bubbleOk: true, mode: 'tray' }) && can({ trayOk: true, bubbleOk: true, mode: 'tray' }));
  check('the default mode is bubble', W.createVisibility({ bubbleOk: true }).mode() === 'bubble' && W.createVisibility({ bubbleOk: true }).canHide());
  const v = W.createVisibility({ trayOk: true, bubbleOk: true, mode: 'bubble' });
  const h = v.request('hide', 'button');
  check('bubble hide effects, in order: stop-drag, close-panel, hide-window, show-bubble, notify-renderer', h.effects.join() === 'stop-drag,close-panel,hide-window,show-bubble,notify-renderer', h.effects.join());
  check('the strip hides BEFORE the bubble shows, the page is told last', idx(h.effects, 'hide-window') < idx(h.effects, 'show-bubble') && idx(h.effects, 'show-bubble') < idx(h.effects, 'notify-renderer'));
  check('hide twice with a bubble: no-op', !v.request('hide', 'bubble').changed && v.hidden());
  const s = v.request('show', 'bubble');
  check('a click on the bubble is a show with reason bubble', s.changed && s.reason === 'bubble' && s.effects.join() === 'place,hide-bubble,show-window,reassert,notify-renderer', s.effects.join());
  check('the bubble hides BEFORE the strip shows (never both on screen)', idx(s.effects, 'hide-bubble') < idx(s.effects, 'show-window') && idx(s.effects, 'place') < idx(s.effects, 'hide-bubble'));
  check('double click: the second show is a no-op', !v.request('show', 'bubble').changed);
  v.request('hide', 'button');
  v.setMode('tray');
  const s2 = v.request('show', 'tray');
  check('the mode changing while hidden still hides the bubble on show', s2.changed && s2.effects.includes('hide-bubble'));
  check('tray mode hide has no bubble effect', v.request('hide', 'tray').effects.join() === 'stop-drag,close-panel,hide-window,notify-renderer');
  v.request('show', 'tray');
  v.setMode('garbage'); v.setMode(undefined); v.setMode(7);
  check('setMode ignores garbage', v.mode() === 'tray');
  check('coerceMode: anything but tray is bubble', W.coerceMode('tray') === 'tray' && W.coerceMode('bubble') === 'bubble' && W.coerceMode('x') === 'bubble' && W.coerceMode(undefined) === 'bubble' && W.coerceMode({}) === 'bubble');
  const nb = W.createVisibility({ trayOk: true, bubbleOk: false, mode: 'bubble' });
  check('bubble mode with a bubble that cannot be made falls back to the old tray rule', nb.canHide() && !nb.usesBubble() && !nb.request('hide', 'button').effects.includes('show-bubble'));
  const none = W.createVisibility({ trayOk: false, bubbleOk: false, mode: 'bubble' });
  check('neither a tray nor a bubble: refused as no-tray', none.request('hide', 'button').refused === 'no-tray' && !none.hidden());
  const lost = W.createVisibility({ trayOk: false, bubbleOk: true, mode: 'bubble' });
  lost.request('hide', 'button');
  lost.setBubble(false);
  check('losing the bubble while hidden never traps the window', lost.request('show', 'second-instance').changed && !lost.hidden() && lost.request('hide', 'button').refused === 'no-tray');
  check('bubble is a listed reason', W.REASONS.includes('bubble') && W.createVisibility({ trayOk: true }).request('toggle', 'bubble').reason === 'bubble');
  check('setBubble / setTray only take a real true', (() => { const x = W.createVisibility({ mode: 'bubble' }); x.setBubble('yes'); x.setTray(1); return !x.canHide(); })());
}

process.exit(failed ? 1 : 0);
