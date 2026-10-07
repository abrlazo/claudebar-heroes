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
import { MAX_AGENTS, parseAgentInvocation } from './lib/agents';
import type { AgentInvocation } from './lib/agents';
import { bar } from './lib/bridge';
import type { Workspace } from './types';
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
// "/plan" or "/plan <task>"
const PLAN_COMMAND = /^\s*\/plan(?:\s+([\s\S]*))?$/i;

function AppShell() {
  const { settings, getSettings, patchWorkspace, persistMessage, updateSettings } = useSettings();
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
  // Read after an await, where the values captured by the render may be stale.
  const projectBusyRef = useRef(false);
  projectBusyRef.current = projectBusy;
  const selectedAgentRef = useRef<string | null>(null);
  selectedAgentRef.current = agents.selectedId;

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

  // "/<agent-name> <task>" runs that agent in its own tab and orb. Only names found under
  // .claude/agents count; skills, other slash commands and plain text are not agents.
  const startAgent = async (target: Workspace, { definition, task }: AgentInvocation, text: string) => {
    persistMessage(target.id, { kind: 'user', text });
    if (agents.agents.filter((a) => a.status === 'running').length >= MAX_AGENTS) {
      persistMessage(target.id, { kind: 'meta', text: `${MAX_AGENTS} agents are already working. Wait for one to finish, or stop it.` });
      return;
    }
    if (!task) {
      persistMessage(target.id, { kind: 'meta', text: `Tell ${definition.name} what to do: /${definition.name} <task>` });
      return;
    }
    say(`Summoning ${definition.name}…`, 2000);
    try {
      await agents.spawn(target, definition, task, settings.permissionMode);
      persistMessage(target.id, { kind: 'meta', text: `${definition.name} is working in its own tab.` });
    } catch (err) {
      persistMessage(target.id, { kind: 'error', text: `Could not start ${definition.name}: ${(err as Error).message}` });
    }
  };

  const sendProjectPrompt = async (typed: string) => {
    if (!ws) return;
    let text = typed;
    let permissionMode = settings.permissionMode;
    // "summon <character>" swaps the hero and is never sent to Claude.
    const summon = findSummon(text);
    if (summon) {
      workspaceActions.summonHero(ws, summon, text);
      return;
    }
    if (text.trimStart().startsWith('/')) {
      // "/<agent-name> <task>" starts an agent, even from inside another agent's tab.
      let definitions: Awaited<ReturnType<typeof bar.agentDefinitions>> = [];
      try {
        definitions = await bar.agentDefinitions(ws.id);
      } catch { /* treat it as an ordinary message rather than losing it */ }
      const invocation = parseAgentInvocation(text, definitions);
      if (invocation) {
        await startAgent(ws, invocation, text);
        return;
      }
      // "/plan [task]": plan mode is the "Plan only" permission mode here, not a headless command.
      const plan = text.match(PLAN_COMMAND);
      if (plan) {
        const task = (plan[1] ?? '').trim();
        if (task && !selectedAgentRef.current && projectBusyRef.current) {
          // Check before changing the mode, so a refused task leaves the settings alone.
          persistMessage(ws.id, { kind: 'user', text });
          persistMessage(ws.id, { kind: 'meta', text: 'Claude is busy, so that /plan task was not sent. Try again when it finishes.' });
          return;
        }
        if (settings.permissionMode !== 'plan') {
          updateSettings({ permissionMode: 'plan' });
          persistMessage(ws.id, { kind: 'meta', text: 'Plan mode is on and stays on (it is saved): Claude plans and changes nothing. Switch the permission dropdown to leave it.' });
        }
        permissionMode = 'plan';
        if (!task) {
          persistMessage(ws.id, { kind: 'user', text });
          return;
        }
        text = task; // continues below as an ordinary message
      }
    }
    // With an agent's tab open, the message goes to that agent and the view stays on it.
    const agent = agents.agents.find((a) => a.id === selectedAgentRef.current);
    if (agent) {
      agents.message(ws, agent.id, text, permissionMode);
      return;
    }
    if (projectBusyRef.current) return;
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
