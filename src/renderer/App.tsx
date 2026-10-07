import { useEffect, useRef, useState } from 'react';
import { SettingsProvider, useActiveWorkspace, useSettings } from './context/SettingsContext';
import { Strip } from './components/strip/Strip';
import { Panel } from './components/panel/Panel';
import { useGameEngine } from './hooks/useGameEngine';
import { useStageStatus } from './hooks/useStageStatus';
import { useClaudeRun } from './hooks/useClaudeRun';
import { useAgents } from './hooks/useAgents';
import { useGeneralChat } from './hooks/useGeneralChat';
import { usePanel } from './hooks/usePanel';
import { useWorkspaceActions } from './hooks/useWorkspaceActions';
import { useClickThrough } from './hooks/useClickThrough';
import { useWindowDrag } from './hooks/useWindowDrag';
import { usePanelResize } from './hooks/usePanelResize';
import { heroFor } from './lib/heroCache';
import { findSummon } from './engine/heroes.js';
import { levelFor, xpFor } from './lib/leveling';
import { DEFAULT_ASK_MODEL, DEFAULT_PROJECT_MODEL } from './lib/models';
import type { MapId, ModelAlias } from './types';

/**
 * Composition root. Wires the hooks together; owns no UI of its own.
 *
 *   settings ──► heroes / HUD / chat history
 *   engine   ──► battle strip (canvas), driven by Claude + agent events
 *   hooks    ──► useClaudeRun (project chat), useAgents, useGeneralChat (Ask)
 */
function AppShell() {
  const { settings, getSettings, patchWorkspace } = useSettings();
  const ws = useActiveWorkspace();
  const { status, setStatus, bubble, say } = useStageStatus();
  const busyRef = useRef(false);
  const [projectModel, setProjectModel] = useState<ModelAlias>(DEFAULT_PROJECT_MODEL);
  const [askModel, setAskModel] = useState<ModelAlias>(DEFAULT_ASK_MODEL);

  const { game, refs } = useGameEngine({
    onKill: (kills) => {
      const id = getSettings().activeId;
      if (id) patchWorkspace(id, { kills });
    },
    onMapChange: (map, kills) => {
      const id = getSettings().activeId;
      if (id) patchWorkspace(id, { map, kills });
    },
    say,
  });
  const run = useClaudeRun({ game, say, setStatus, stageRef: refs.stageRef, busyRef });
  const agents = useAgents({ game, say });
  const ask = useGeneralChat();
  const panel = usePanel();

  // busy blocks UI changes; projectBusy only blocks project chat send
  const busy = run.running || agents.running;
  const projectBusy = run.running;
  busyRef.current = busy;

  // The hero is awake exactly while Claude or an agent is working, and sleeps once both are done.
  // (Driven by state: a ref-based check at event time is stale until the next render.)
  useEffect(() => {
    if (busy) game.wake();
    else game.sleep();
  }, [busy, game]);

  const workspaceActions = useWorkspaceActions({ busy, say });
  useClickThrough();
  const dragProps = useWindowDrag();
  const resizeProps = usePanelResize();

  // Theme.
  useEffect(() => {
    const light = settings.theme === 'light';
    document.body.classList.toggle('theme-light', light);
    document.body.classList.toggle('theme-dark', !light);
  }, [settings.theme]);

  // Switching hero/project: configure the engine and return to the project chat.
  const wsId = ws?.id;
  const heroSeed = ws?.heroSeed;
  useEffect(() => {
    game.configure({ hero: heroFor(ws), mapId: ws?.map || 'forest', kills: ws?.kills || 0 });
    if (!busyRef.current) setStatus(ws ? 'Sleeping' : '');
    agents.select(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the hero or project changes
  }, [wsId, heroSeed]);

  // HUD status for agent-only work (the main chat sets its own status per event).
  const agentCount = agents.agents.filter((a) => a.status === 'running').length;
  const wasAgentsRunning = useRef(false);
  useEffect(() => {
    if (run.running) return undefined;
    if (agents.running) {
      wasAgentsRunning.current = true;
      setStatus(agentCount > 0 ? `⚔ ${agentCount} agent${agentCount > 1 ? 's' : ''} working…` : 'Spawning agents…');
      return undefined;
    }
    if (!wasAgentsRunning.current) return undefined;
    wasAgentsRunning.current = false;
    setStatus('Agents done');
    const timer = setTimeout(() => { if (!busyRef.current) setStatus('Sleeping'); }, 3000);
    return () => clearTimeout(timer);
  }, [agents.running, agentCount, run.running, setStatus]);

  // Level prestige (weapon glow from 10, aura from 15) follows the hero's level.
  const level = ws ? levelFor(xpFor(ws)) : 0;
  useEffect(() => { game.configure({ level }); }, [game, level, wsId, heroSeed]);

  const map = ws?.map;
  useEffect(() => { if (map) game.configure({ mapId: map }); }, [map, game]);

  const sendProjectPrompt = (text: string) => {
    if (!ws) return;
    // "summon <character>" swaps the hero and is never sent to Claude.
    const summon = findSummon(text);
    if (summon) {
      workspaceActions.summonHero(ws, summon, text);
      return;
    }
    // With an agent's tab open, the message goes to that agent and the view stays on it.
    const agent = agents.agents.find((a) => a.id === agents.selectedId);
    if (agent) {
      agents.message(ws, agent.id, text, settings.permissionMode);
      return;
    }
    if (projectBusy) return;
    agents.select(null);
    run.send(ws.id, text, projectModel);
  };

  const stop = () => {
    // Stop also has to reach agents, or the UI stays busy until they finish.
    if (ws) agents.stopAll(ws.id);
    run.stop();
  };

  const pickMap = (id: MapId) => {
    if (!ws) return;
    patchWorkspace(ws.id, { map: id });
    game.configure({ mapId: id });
  };

  return (
    <>
      <Panel
        panel={panel}
        dragProps={dragProps}
        resizeProps={resizeProps}
        project={{
          ws, run, agents, busy, projectBusy, workspaceActions,
          model: projectModel, onModelChange: setProjectModel, onSend: sendProjectPrompt, onStop: stop,
        }}
        ask={{ chat: ask, model: askModel, onModelChange: setAskModel }}
        inventory={{ ws, busy, actions: workspaceActions, onPickMap: pickMap }}
      />
      <Strip
        onTogglePanel={() => panel.toggle()}
        stageProps={{
          refs, bubble, game, dragProps,
          hasWorkspace: !!ws,
          onImport: workspaceActions.importProject,
          agents: agents.agents,
          agentBatch: agents.batch,
        }}
        hudProps={{ ws, game, status, dragProps }}
      />
    </>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  );
}
