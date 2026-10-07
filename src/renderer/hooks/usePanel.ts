import { useCallback, useEffect, useRef, useState } from 'react';
import { bar } from '../lib/bridge';
import { useBridgeEvent } from './useBridgeEvent';

export const TABS = { PROJECT: 'project-chat', ASK: 'general-chat', INVENTORY: 'settings' } as const;
export type TabName = (typeof TABS)[keyof typeof TABS];
type Side = 'above' | 'below';

export interface PanelState {
  open: boolean;
  tab: TabName;
  setTab: (tab: TabName) => void;
  toggle: (force?: boolean) => Promise<void>;
}

/**
 * Open/closed state, active tab and which side of the strip the panel opens
 * on. Opening grows the OS window first (main process), then shows the panel.
 */
export function usePanel(): PanelState {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabName>(TABS.PROJECT);
  const [side, setSide] = useState<Side>('above');
  const openRef = useRef(false);

  const toggle = useCallback(async (force?: boolean) => {
    const next = force ?? !openRef.current;
    if (next === openRef.current) return;
    if (next) {
      // Lay out for the side the panel will open on before the window grows.
      setSide(await bar.panelSide());
      await bar.setPanelOpen(true);
      openRef.current = true;
      setOpen(true);
      bar.focus();
    } else {
      openRef.current = false;
      setOpen(false);
      await bar.setPanelOpen(false);
    }
  }, []);

  useBridgeEvent<void>(bar.onTogglePanel, () => { toggle(); });
  useBridgeEvent(bar.onPanelSide, setSide);

  useEffect(() => {
    document.body.classList.toggle('panel-below', side === 'below');
  }, [side]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') toggle(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [toggle]);

  return { open, tab, setTab, toggle };
}
