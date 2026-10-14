import { useCallback, useEffect, useRef, useState } from 'react';
import { bar } from '../lib/bridge';
import { useBridgeEvent } from './useBridgeEvent';
import type { DrawerMode, PipelineMode } from '../types';

export const TABS = { PROJECT: 'project-chat', ASK: 'general-chat', INVENTORY: 'settings' } as const;
export type TabName = (typeof TABS)[keyof typeof TABS];
type Side = 'above' | 'below';

export interface PanelState {
  open: boolean;
  tab: TabName;
  setTab: (tab: TabName) => void;
  toggle: (force?: boolean) => Promise<void>;
  /** The archive drawer beside the panel is open (it closes whenever the panel does). */
  drawerOpen: boolean;
  toggleDrawer: (force?: boolean) => Promise<void>;
  /** The workflow pipeline pane is open (a companion of the panel, like the drawer) and where it sits. */
  pipelineOpen: boolean;
  pipelineMode: PipelineMode | null;
  /** Says whether the pipeline pane is wanted; it opens only while the panel is open and follows main's answer. */
  setPipelineWanted: (wanted: boolean) => void;
}

/**
 * Open/closed state, active tab and which side of the strip the panel opens
 * on. Opening grows the OS window first (main process), then shows the panel.
 * The archive drawer works the same way: the renderer only asks, main picks the
 * mode (left / right / overlay) and the window rectangle.
 */
export function usePanel(): PanelState {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabName>(TABS.PROJECT);
  const [side, setSide] = useState<Side>('above');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mode, setMode] = useState<DrawerMode | null>(null);
  const openRef = useRef(false);
  const drawerRef = useRef(false);
  const drawerBusy = useRef(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [pipeMode, setPipeMode] = useState<PipelineMode | null>(null);
  const pipeRef = useRef(false); // the pane is open (main granted it)
  const pipeWanted = useRef(false);
  const pipeBusy = useRef(false);
  const hiddenRef = useRef(false); // the window is hidden (main refuses to open the panel then)

  const toggleDrawer = useCallback(async (force?: boolean) => {
    const next = force ?? !drawerRef.current;
    if (next === drawerRef.current || drawerBusy.current) return;
    if (next && (!openRef.current || hiddenRef.current)) return;
    drawerBusy.current = true;
    try {
      if (next) {
        // Anchor the strip and panel for the mode first (the window is still narrow, so nothing moves), then grow.
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

  // Same sequence as the drawer: anchor for the mode first (the window is still narrow), then grow; shrink, then unanchor.
  // The wish is re-read after every await, so a change made while main was answering is never lost.
  const syncPipeline = useCallback(async () => {
    if (pipeBusy.current) return;
    pipeBusy.current = true;
    try {
      while (pipeRef.current !== pipeWanted.current) {
        if (pipeWanted.current) {
          if (!openRef.current || hiddenRef.current) { pipeWanted.current = false; break; }
          setPipeMode(await bar.pipelineMode());
          const granted = await bar.setPipelineOpen(true);
          if (granted === 'none' || !openRef.current) { setPipeMode(null); pipeWanted.current = false; break; }
          setPipeMode(granted);
          pipeRef.current = true;
          setPipelineOpen(true);
        } else {
          pipeRef.current = false;
          setPipelineOpen(false);
          await bar.setPipelineOpen(false);
          setPipeMode(null);
        }
      }
    } finally {
      pipeBusy.current = false;
    }
  }, []);

  const setPipelineWanted = useCallback((wanted: boolean) => {
    pipeWanted.current = wanted;
    void syncPipeline();
  }, [syncPipeline]);

  const toggle = useCallback(async (force?: boolean) => {
    const next = force ?? !openRef.current;
    if (next === openRef.current) return;
    if (next) {
      if (hiddenRef.current) return;
      // Lay out for the side the panel will open on before the window grows.
      setSide(await bar.panelSide());
      await bar.setPanelOpen(true);
      // Hidden meanwhile: main refused, so do not show a panel the window cannot hold.
      if (hiddenRef.current) return;
      openRef.current = true;
      setOpen(true);
      bar.focus();
    } else {
      openRef.current = false;
      setOpen(false);
      drawerRef.current = false;
      setDrawerOpen(false);
      pipeRef.current = false;
      setPipelineOpen(false);
      await bar.setPanelOpen(false); // main closes the drawer and the pipeline with the panel: one resize
      setMode(null);
      if (!pipeRef.current) setPipeMode(null);
    }
  }, []);

  useBridgeEvent<void>(bar.onTogglePanel, () => { toggle(); });
  // Hiding the app closes the panel (and the drawer with it) first; main does the same for the window.
  useBridgeEvent(bar.onWindowVisible, ({ visible }) => {
    hiddenRef.current = !visible;
    if (!visible) { void toggle(false); }
  });
  useBridgeEvent(bar.onPanelSide, setSide);
  // After a drag the strip may have moved where the drawer fits on another side.
  useBridgeEvent(bar.onDrawerMode, (m: DrawerMode) => { if (drawerRef.current) setMode(m); });
  useBridgeEvent(bar.onPipelineMode, (m: PipelineMode) => { if (pipeRef.current) setPipeMode(m); });

  useEffect(() => {
    document.body.classList.toggle('panel-below', side === 'below');
  }, [side]);

  useEffect(() => {
    const cls = document.body.classList;
    for (const m of ['left', 'right', 'overlay']) cls.toggle(`drawer-${m}`, mode === m);
    cls.toggle('drawer-open', drawerOpen && mode !== null);
  }, [mode, drawerOpen]);

  useEffect(() => {
    const cls = document.body.classList;
    for (const m of ['left', 'right', 'inline']) cls.toggle(`pipe-${m}`, pipeMode === m);
    cls.toggle('pipe-open', pipelineOpen && pipeMode !== null);
  }, [pipeMode, pipelineOpen]);

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

  return { open, tab, setTab, toggle, drawerOpen, toggleDrawer, pipelineOpen, pipelineMode: pipeMode, setPipelineWanted };
}
