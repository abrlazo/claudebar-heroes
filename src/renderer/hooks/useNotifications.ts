import { useCallback, useEffect, useRef, useState } from 'react';
import { bar } from '../lib/bridge';
import { TABS } from './usePanel';
import type { PanelState } from './usePanel';
import { useBridgeEvent } from './useBridgeEvent';
import type { NotifyEvent, NotifyTarget } from '../types';

/** How long the hero's bubble and the toast stay up. */
const BUBBLE_MS = 7000;
const TOAST_MS = 8000;

export interface NotifyCueState extends NotifyEvent {
  /** Changes with every cue so a repeat restarts the timer. */
  seq: number;
}

interface Args {
  panel: PanelState;
  wsId: string | null;
  /** The agent whose tab is open, or null for the Expedition (Quest) chat. */
  agentId: string | null;
  agentIds: string[];
  say: (text: string, ms?: number) => void;
  selectAgent: (id: string | null) => void;
}

/**
 * Main decides when to notify and builds all the text; this hook only shows it. It also tells main what is on screen
 * (tab, workspace, agent), so main stays quiet about a chat you are reading. Panel closed: the hero's bubble.
 * Panel open (on another tab or chat): a small toast. A click on the system notification (or the toast's Show) opens
 * the panel on the right chat.
 */
export function useNotifications({ panel, wsId, agentId, agentIds, say, selectAgent }: Args) {
  const [cue, setCue] = useState<NotifyCueState | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    bar.setNotifyView({ tab: panel.tab, wsId, agentId });
  }, [panel.tab, wsId, agentId]);

  useBridgeEvent<NotifyEvent>(bar.onNotify, (note) => {
    if (!panel.open) {
      say(`${note.kind === 'failed' || note.kind === 'mixed' ? '⚠ ' : ''}${note.title}`, BUBBLE_MS);
      return;
    }
    seq.current += 1;
    setCue({ ...note, seq: seq.current });
  });

  const show = useCallback((target: NotifyTarget | null) => {
    setCue(null);
    void panel.toggle(true);
    // Another workspace than the active one: only the panel opens (switching is refused while work runs anyway).
    if (!target || !target.wsId || target.wsId !== wsId) return;
    panel.setTab(TABS.PROJECT);
    selectAgent(target.agentId && agentIds.includes(target.agentId) ? target.agentId : null);
  }, [panel, wsId, agentIds, selectAgent]);

  useBridgeEvent<NotifyTarget>(bar.onNotifyOpen, show);

  // The toast goes away by itself, and with the panel.
  useEffect(() => {
    if (!cue) return undefined;
    const timer = setTimeout(() => setCue(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [cue]);
  useEffect(() => { if (!panel.open) setCue(null); }, [panel.open]);

  return { cue, show, dismiss: () => setCue(null) };
}
