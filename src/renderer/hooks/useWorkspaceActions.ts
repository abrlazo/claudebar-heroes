import { useCallback } from 'react';
import { bar } from '../lib/bridge';
import { useSettings } from '../context/SettingsContext';
import { heroFor } from '../lib/heroCache';
import type { Workspace } from '../types';

/**
 * Workspace (project) operations shared by the roster, the project picker
 * and the empty-state button. All of them are blocked while Claude is busy.
 */
export interface WorkspaceActions {
  importProject: () => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  removeProject: (ws: Workspace) => Promise<void>;
  rerollHero: (ws: Workspace) => Promise<void>;
  newSession: () => Promise<void>;
  /** Swaps the project's hero for a summoned character, e.g. when the user types "summon yoda". */
  summonHero: (ws: Workspace, summon: SummonRequest, userText: string) => Promise<void>;
}

export interface SummonRequest {
  seed: string;
  name: string;
  /** Catchphrase shown in the speech bubble (famous characters only). */
  quote?: string;
}

export function useWorkspaceActions({ busy, say }: { busy: boolean; say: (text: string, ms?: number) => void }): WorkspaceActions {
  const { settings, replace, persistMessage, getSettings } = useSettings();

  const importProject = useCallback(async () => {
    if (busy) return;
    const known = new Set(getSettings().workspaces.map((w) => w.id));
    const next = await bar.importWorkspace();
    if (!next) return;
    replace(next);
    const ws = next.workspaces.find((w) => w.id === next.activeId);
    if (ws && !known.has(ws.id)) {
      const hero = heroFor(ws);
      say(`${hero.name} the ${hero.cls} joins!`, 3500);
      persistMessage(ws.id, { kind: 'meta', text: `${hero.name} the ${hero.cls} will guard ${ws.name}` });
    }
  }, [busy, getSettings, persistMessage, replace, say]);

  const selectProject = useCallback(async (id: string) => {
    if (busy || id === getSettings().activeId) return;
    replace(await bar.selectWorkspace(id));
  }, [busy, getSettings, replace]);

  const removeProject = useCallback(async (ws: Workspace) => {
    if (busy && ws.id === settings.activeId) {
      say('Not while Claude is working here!', 2500);
      return;
    }
    const hero = heroFor(ws);
    if (!window.confirm(`Remove ${ws.name}?\n\n${hero.name} the ${hero.cls} and its progress will be forgotten. Your project files aren't touched.`)) return;
    replace(await bar.removeWorkspace(ws.id));
  }, [busy, replace, say, settings.activeId]);

  const rerollHero = useCallback(async (ws: Workspace) => {
    if (busy) return;
    const next = await bar.rerollHero(ws.id);
    replace(next);
    const updated = next.workspaces.find((w) => w.id === ws.id) ?? ws;
    const hero = heroFor(updated);
    say(`${hero.name} the ${hero.cls} joins!`, 3000);
  }, [busy, replace, say]);

  const newSession = useCallback(async () => {
    const ws = getSettings().workspaces.find((w) => w.id === getSettings().activeId);
    if (busy || !ws) return;
    // Main clears both the session and the saved messages, otherwise the old
    // chat comes back on the next workspace switch or restart.
    const next = await bar.newSession();
    replace(next);
    persistMessage(ws.id, { kind: 'meta', text: 'New session started' });
  }, [busy, getSettings, persistMessage, replace]);

  const summonHero = useCallback(async (ws: Workspace, summon: SummonRequest, userText: string) => {
    persistMessage(ws.id, { kind: 'user', text: userText });
    if (busy) {
      say('Not while Claude is working here!', 2500);
      persistMessage(ws.id, { kind: 'meta', text: 'The summoning must wait until Claude has finished.' });
      return;
    }
    if (ws.heroSeed === summon.seed) {
      say(`${summon.name} is already here.`, 2500);
      persistMessage(ws.id, { kind: 'meta', text: `${summon.name} is already guarding ${ws.name}.` });
      return;
    }
    replace(await bar.rerollHero(ws.id, summon.seed));
    say(summon.quote ?? `${summon.name} has arrived!`, 3500);
    persistMessage(ws.id, { kind: 'meta', text: `${summon.name} answers your call and now guards ${ws.name}.` });
  }, [busy, persistMessage, replace, say]);

  return { importProject, selectProject, removeProject, rerollHero, newSession, summonHero };
}
