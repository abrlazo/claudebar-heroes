import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { bar } from '../lib/bridge';
import type { ArchivedAgent, ChatMessage, Settings, Workspace } from '../types';

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
  /** A map boss fell: count it on the workspace's trophy shelf, locally and on disk. */
  addTrophy: (id: string, bossId: string) => void;
  /** Append a chat message to a workspace, locally and on disk. */
  persistMessage: (wsId: string, message: ChatMessage) => void;
  /** Patch top-level settings (theme, panelHeight, ...) locally and persist. */
  updateSettings: (patch: Partial<Settings>) => void;
  /** Patch top-level settings locally only (e.g. during a live drag). */
  updateSettingsLocal: (patch: Partial<Settings>) => void;
  /** Keep a retired / closed agent's chat in the project's archive. False when main refused or the call failed. */
  archiveAgent: (wsId: string, record: Omit<ArchivedAgent, 'archivedAt'>) => Promise<boolean>;
  deleteArchived: (wsId: string, id: string) => Promise<boolean>;
  clearArchive: (wsId: string) => Promise<boolean>;
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

  const applyArchive = useCallback(async (call: Promise<{ archive: ArchivedAgent[] } | null>, wsId: string) => {
    try {
      const result = await call;
      if (!result) return false;
      mapWorkspace(wsId, (w) => ({ ...w, archive: result.archive }));
      return true;
    } catch {
      return false;
    }
  }, [mapWorkspace]);

  const actions = useMemo(() => ({
    replace: (next: Settings) => setSettings(next),
    patchWorkspaceLocal: (id: string, patch: Partial<Workspace>) => mapWorkspace(id, (w) => ({ ...w, ...patch })),
    patchWorkspace: (id: string, patch: ProgressPatch) => {
      mapWorkspace(id, (w) => ({ ...w, ...patch }));
      bar.updateWorkspace(id, patch);
    },
    addTrophy: (id: string, bossId: string) => {
      mapWorkspace(id, (w) => {
        const old = w.trophies?.[bossId];
        return { ...w, trophies: { ...w.trophies, [bossId]: { count: Math.min((old?.count || 0) + 1, 9999), firstAt: old?.firstAt || Date.now() } } };
      });
      bar.addTrophy(id, bossId);
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
    // The archive is written by main only; its answer (that project's list) is the authority.
    archiveAgent: (wsId: string, record: Omit<ArchivedAgent, 'archivedAt'>) => applyArchive(bar.archiveAgent(wsId, record), wsId),
    deleteArchived: (wsId: string, id: string) => applyArchive(bar.deleteArchived(wsId, id), wsId),
    clearArchive: (wsId: string) => applyArchive(bar.clearArchive(wsId), wsId),
  }), [applyArchive, mapWorkspace]);

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
