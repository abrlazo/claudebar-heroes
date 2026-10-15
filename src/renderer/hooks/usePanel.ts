import { useCallback, useEffect, useRef, useState } from 'react';
import { bar } from '../lib/bridge';
import { useBridgeEvent } from './useBridgeEvent';
import type { DrawerMode, PanelLayout } from '../types';
import { useSettings } from '../context/SettingsContext';
import { parseLayout, shownPanelH } from '../lib/layout';

export const TABS = { PROJECT: 'project-chat', ASK: 'general-chat', INVENTORY: 'settings' } as const;
export type TabName = (typeof TABS)[keyof typeof TABS];
type Side = 'above' | 'below';
/** Length of the panel's enter / exit animation (keep in sync with `--panel-anim` in styles.css). */
export const PANEL_ANIM_MS = 140;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** One animation frame, with a fallback timer because a throttled page may not fire it. Only the fit-to-open window (Linux, CBH_WINDOW_FIT=1) needs it. */
const nextFrame = () => new Promise<void>((resolve) => {
  const t = setTimeout(resolve, 50);
  requestAnimationFrame(() => { clearTimeout(t); resolve(); });
});

export interface PanelState {
  open: boolean;
  /** The exit animation is playing; the panel is still mounted (the OS window does not change either way). */
  closing: boolean;
  tab: TabName;
  setTab: (tab: TabName) => void;
  toggle: (force?: boolean, immediate?: boolean) => Promise<void>;
  /** The archive drawer beside the panel is open (it closes whenever the panel does). */
  drawerOpen: boolean;
  toggleDrawer: (force?: boolean) => Promise<void>;
  /** The tallest panel (height + gap) the window holds; the resize handle stops there. */
  maxPanelH: number;
}

/**
 * Open/closed state, active tab and which side of the strip the panel opens on.
 * The OS window has a fixed size (main/window-layout.js), so opening and closing the panel and the archive drawer is
 * pure CSS and never moves the strip. Main reports the layout (`panel:layout`: side, room, drawer mode) and the
 * renderer only asks; main picks the mode (left / right / overlay) and the window rectangle. In the fit-to-open
 * fallback (`layout.fixed === false`: Linux, CBH_WINDOW_FIT=1) the window still grows with the panel, so the panel is
 * shown one frame after main resized it.
 */
export function usePanel(): PanelState {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tab, setTab] = useState<TabName>(TABS.PROJECT);
  const { settings } = useSettings();
  const [layout, setLayout] = useState<PanelLayout | null>(null);
  const [side, setSide] = useState<Side>('above');
  const fixedRef = useRef(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<DrawerMode | null>(null);
  const openRef = useRef(false);
  const drawerRef = useRef(false);
  const drawerBusy = useRef(false);
  const hiddenRef = useRef(false); // the window is hidden (main refuses to open the panel then)

  const toggleDrawer = useCallback(async (force?: boolean) => {
    const next = force ?? !drawerRef.current;
    if (next === drawerRef.current || drawerBusy.current) return;
    if (closeTimer.current !== null) return; // the panel is closing: the drawer goes with it, it cannot start over
    if (next && (!openRef.current || hiddenRef.current)) return;
    drawerBusy.current = true;
    try {
      if (next) {
        // Fit mode: anchor the strip and panel for the mode first (the window is still narrow, so nothing moves), then grow.
        setMode(await bar.drawerMode());
        const granted = await bar.setDrawerOpen(true);
        if (granted === 'none' || !openRef.current) { setMode(null); return; } // refused, or the panel closed meanwhile
        setMode(granted);
        drawerRef.current = true;
        setDrawerOpen(true);
      } else {
        drawerRef.current = false;
        setDrawerOpen(false);
        await bar.setDrawerOpen(false);
        setMode(null);
      }
    } finally {
      drawerBusy.current = false;
    }
  }, []);

  const clearCloseTimer = () => {
    if (closeTimer.current !== null) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };

  const finishClose = useCallback(async () => {
    closeTimer.current = null;
    openRef.current = false;
    setClosing(false);
    setOpen(false);
    drawerRef.current = false;
    setDrawerOpen(false);
    await bar.setPanelOpen(false); // main closes the drawer with the panel (fit mode: one resize)
    setMode(null);
  }, []);

  // `immediate`: no exit animation (the window is being hidden).
  const toggle = useCallback(async (force?: boolean, immediate = false) => {
    const next = force ?? !openRef.current;
    if (next && closeTimer.current !== null) {
      // Reopened while the exit was playing: nothing was closed yet, just stop closing.
      clearCloseTimer();
      setClosing(false);
      return;
    }
    if (next === openRef.current) return;
    if (next) {
      if (hiddenRef.current) return;
      // Fit mode: lay out for the side the panel will open on before the window grows. Fixed: the side is already known.
      if (!fixedRef.current) setSide(await bar.panelSide());
      await bar.setPanelOpen(true);
      // Hidden meanwhile: main refused, so do not show a panel the window cannot hold.
      if (hiddenRef.current) return;
      if (!fixedRef.current) { // the page must take the new window size before the panel shows
        await nextFrame();
        if (hiddenRef.current) return;
      }
      openRef.current = true;
      setOpen(true);
      bar.focus();
    } else if (immediate || reducedMotion()) {
      clearCloseTimer();
      await finishClose();
    } else {
      if (closeTimer.current !== null) return; // already closing
      setClosing(true);
      closeTimer.current = setTimeout(() => { void finishClose(); }, PANEL_ANIM_MS);
    }
  }, [finishClose]);

  useEffect(() => clearCloseTimer, []);

  useBridgeEvent<void>(bar.onTogglePanel, () => { toggle(); });
  // Hiding the app closes the panel (and the drawer with it) first; main does the same for the window.
  useBridgeEvent(bar.onWindowVisible, ({ visible }) => {
    hiddenRef.current = !visible;
    if (!visible) { void toggle(false, true); }
  });
  const applyLayout = useCallback((raw: unknown) => {
    const l = parseLayout(raw);
    if (!l) return;
    fixedRef.current = l.fixed;
    setLayout(l);
    setSide(l.side);
    if (l.fixed && drawerRef.current) setMode(l.drawerMode); // the strip moved to where the drawer goes on another side
  }, []);
  useBridgeEvent(bar.onPanelLayout, applyLayout);
  useEffect(() => { void bar.panelLayout().then(applyLayout, () => undefined); }, [applyLayout]);
  // Fit mode only: after a drag the strip may have moved where the drawer fits on another side.
  useBridgeEvent(bar.onDrawerMode, (m: DrawerMode) => { if (drawerRef.current) setMode(m); });

  useEffect(() => {
    document.body.classList.toggle('panel-closing', closing);
  }, [closing]);

  useEffect(() => {
    document.body.classList.toggle('panel-below', side === 'below');
  }, [side]);

  // Fixed window: the panel and the drawer get their height from --panel-h (so resizing is live) and the strip and panel
  // are anchored to the edge that never moves (win-left / win-right) for as long as the layout says so.
  useEffect(() => {
    const cls = document.body.classList;
    const fixed = !!layout?.fixed;
    cls.toggle('win-fixed', fixed);
    cls.toggle('win-left', fixed && layout?.drawerMode === 'left');
    cls.toggle('win-right', fixed && layout?.drawerMode === 'right');
    const root = document.documentElement.style;
    if (layout && fixed) root.setProperty('--panel-h', `${shownPanelH(settings.panelHeight, layout)}px`);
    else root.removeProperty('--panel-h');
  }, [layout, settings.panelHeight]);

  useEffect(() => {
    const cls = document.body.classList;
    for (const m of ['left', 'right', 'overlay']) cls.toggle(`drawer-${m}`, mode === m);
    cls.toggle('drawer-open', drawerOpen && mode !== null);
  }, [mode, drawerOpen]);

  // Esc closes the topmost thing: the "/" popup stops it itself, then the drawer, then the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (drawerRef.current) toggleDrawer(false);
      else toggle(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggle, toggleDrawer]);

  return { open, closing, tab, setTab, toggle, drawerOpen, toggleDrawer, maxPanelH: layout?.maxPanelH ?? 1000 };
}
