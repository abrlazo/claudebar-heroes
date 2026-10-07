import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { bar } from '../lib/bridge';
import type { ChatMessage, Settings, Workspace } from '../types';

/** Fields of a workspace the main process lets the renderer persist directly. */
type ProgressPatch = Partial<Pick<Workspace, 'kills' | 'map'>>;

interface SettingsApi {
  settings: Settings;
  /** Replace everything with the authoritative copy returned by main. */
  replace: (next: Settings) => void;
  /** Apply a patch to a workspace locally only (main already knows). */
  patchWorkspaceLocal: (id: string, patch: Partial<Workspace>) => void;
  /** Apply a patch to a workspace locally and persist it (kills / map only). */
  patchWorkspace: (id: string, patch: ProgressPatch) => void;
  /** Append a chat message to a workspace, locally and on disk. */
  persistMessage: (wsId: string, message: ChatMessage) => void;
  /** Patch top-level settings (theme, panelHeight, ...) locally and persist. */
  updateSettings: (patch: Partial<Settings>) => void;
  /** Patch top-level settings locally only (e.g. during a live drag). */
  updateSettingsLocal: (patch: Partial<Settings>) => void;
  /** Always-current settings for event handlers that outlive a render. */
  getSettings: () => Settings;
}

/**
 * Renderer-side mirror of settings.json (owned by the main process).
 *
 * Updates are applied locally first so the UI never waits on IPC, then sent to
 * the main process to be persisted. Components read state with `useSettings()`
 * and never touch `bar` for settings directly.
 */
const SettingsContext = createContext<SettingsApi | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  settingsRef.current = settings;

  useEffect(() => {
    bar.getSettings().then(setSettings);
  }, []);

  const mapWorkspace = useCallback((id: string, fn: (w: Workspace) => Workspace) => {
    setSettings((s) => (s ? { ...s, workspaces: s.workspaces.map((w) => (w.id === id ? fn(w) : w)) } : s));
  }, []);

  const actions = useMemo(() => ({
    replace: (next: Settings) => setSettings(next),
    patchWorkspaceLocal: (id: string, patch: Partial<Workspace>) => mapWorkspace(id, (w) => ({ ...w, ...patch })),
    patchWorkspace: (id: string, patch: ProgressPatch) => {
      mapWorkspace(id, (w) => ({ ...w, ...patch }));
      bar.updateWorkspace(id, patch);
    },
    persistMessage: (wsId: string, message: ChatMessage) => {
      mapWorkspace(wsId, (w) => ({ ...w, messages: [...(w.messages || []), message] }));
      bar.addMessage(wsId, message);
    },
    updateSettings: (patch: Partial<Settings>) => {
      setSettings((s) => (s ? { ...s, ...patch } : s));
      bar.updateSettings(patch);
    },
    updateSettingsLocal: (patch: Partial<Settings>) => setSettings((s) => (s ? { ...s, ...patch } : s)),
    getSettings: () => settingsRef.current as Settings,
  }), [mapWorkspace]);

  const value = useMemo(() => (settings ? { settings, ...actions } : null), [settings, actions]);
  if (!value) return null;
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsApi {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}

/** The workspace currently selected as orchestrator, or null. */
export function useActiveWorkspace(): Workspace | null {
  const { settings } = useSettings();
  return settings.workspaces.find((w) => w.id === settings.activeId) || null;
}
