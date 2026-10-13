import { useEffect, useState } from 'react';
import { bar } from '../lib/bridge';
import { useBridgeEvent } from './useBridgeEvent';
import type { GameApi } from './useGameEngine';
import type { MinimizeTo } from '../types';

export interface WindowVisibility {
  canHide: boolean;
  hide: () => void;
  /** Where hiding goes right now: the floating bubble, or only the tray icon. */
  to: MinimizeTo;
  /** The tray icon exists ("Tray only" is possible). */
  tray: boolean;
}

/**
 * Main hides and shows the window (the tray, the shortcut, the hide buttons...); this hook only follows it.
 * While hidden the battle loop is paused (`game.suspend`, `body.app-hidden`); every IPC handler keeps running, so
 * runs, agents, XP and notifications are untouched. The panel closes itself in `usePanel`, the click-through flag in
 * `useClickThrough`. Also reports whether hiding is possible at all (main decides: the tray icon, or the bubble) and
 * where it goes; the answer is read again when the "Minimize to" setting changes.
 */
export function useWindowVisibility(game: GameApi, minimizeTo: MinimizeTo = 'bubble'): WindowVisibility {
  const [canHide, setCanHide] = useState(false);
  const [to, setTo] = useState<MinimizeTo>('bubble');
  const [tray, setTray] = useState(true);

  useEffect(() => {
    let alive = true;
    bar.windowInfo().then((info) => {
      if (!alive) return;
      setCanHide(info.canHide === true);
      setTo(info.minimizeTo === 'tray' ? 'tray' : 'bubble');
      setTray(info.tray !== false);
    }).catch(() => {});
    return () => { alive = false; };
  }, [minimizeTo]);

  useBridgeEvent(bar.onWindowVisible, ({ visible }) => {
    document.body.classList.toggle('app-hidden', !visible);
    if (visible) game.resume();
    else game.suspend();
  });

  return { canHide, hide: () => { void bar.hideWindow(); }, to, tray };
}
