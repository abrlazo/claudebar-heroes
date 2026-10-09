import { useEffect, useRef, useState } from 'react';
import { SettingsProvider, useActiveWorkspace, useSettings } from './context/SettingsContext';
import { Strip } from './components/strip/Strip';
import { Panel } from './components/panel/Panel';
import { ArchiveDrawer } from './components/panel/ArchiveDrawer';
import { useGameEngine } from './hooks/useGameEngine';
import { useStageStatus } from './hooks/useStageStatus';
import { useAchievements } from './hooks/useAchievements';
import { useClaudeRun } from './hooks/useClaudeRun';
import type { RunEnd } from './hooks/useClaudeRun';
import { useMessageQueue } from './hooks/useMessageQueue';
import { useAgents } from './hooks/useAgents';
import { usePermissions } from './hooks/usePermissions';
import { useGeneralChat } from './hooks/useGeneralChat';
import { usePanel } from './hooks/usePanel';
import { useWorkspaceActions } from './hooks/useWorkspaceActions';
import { useClickThrough } from './hooks/useClickThrough';
import { useWindowDrag } from './hooks/useWindowDrag';
import { usePanelResize } from './hooks/usePanelResize';
import { heroFor } from './lib/heroCache';
import { findSummon } from './engine/heroes.js';
import { BOSSES, LEGENDARY_BOSS } from './engine/enemies.js';
import { MAX_AGENTS, MAX_CHAIN_STEPS, parseAgentChain, parseAgentInvocation } from './lib/agents';
import type { AgentInvocation } from './lib/agents';
import { bar } from './lib/bridge';
import { MAX_QUEUED } from './lib/queue';
import type { Workspace } from './types';
import { levelFor, xpFor } from './lib/leveling';
import { DEFAULT_ASK_MODEL, DEFAULT_PROJECT_MODEL } from './lib/models';
import type { ClaudeEvent, MapId, ModelAlias } from './types';

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
  const { settings, getSettings, patchWorkspace, addTrophy, persistMessage, updateSettings, archiveAgent, deleteArchived, clearArchive } = useSettings();
  const ws = useActiveWorkspace();
  const { status, setStatus, bubble, say } = useStageStatus();
  const busyRef = useRef(false);
  const [projectModel, setProjectModel] = useState<ModelAlias>(DEFAULT_PROJECT_MODEL);
  const [askModel, setAskModel] = useState<ModelAlias>(DEFAULT_ASK_MODEL);

  // Achievements read stats the engine reports; `ach` is filled below, once the hook exists.
  const achRef = useRef<ReturnType<typeof useAchievements> | null>(null);
  const { game, refs } = useGameEngine({
    onCombo: (n) => achRef.current?.noteCombo(n),
    onCrit: () => achRef.current?.noteCrit(),
    onKill: (kills) => {
      const id = getSettings().activeId;
      if (id) patchWorkspace(id, { kills });
    },
    onMapChange: (map, kills) => {
      const id = getSettings().activeId;
      if (id) patchWorkspace(id, { map, kills });
    },
    onBossDefeated: (bossId) => {
      const id = getSettings().activeId;
      if (!id) return;
      const first = !getSettings().workspaces.find((w) => w.id === id)?.trophies?.[bossId];
      addTrophy(id, bossId);
      const boss = [...Object.values(BOSSES), LEGENDARY_BOSS].find((b) => b.id === bossId);
      if (first && boss) say(boss.legendary ? `Legendary trophy: ${boss.name}` : `Trophy: ${boss.name}`, boss.legendary ? 2400 : 1800);
    },
    say,
  });
  const ach = useAchievements(say, ws);
  achRef.current = ach;
  // An inner event of a delegation that is not a shown agent goes back to the run as an ordinary event.
  const replayRef = useRef<(ev: ClaudeEvent) => void>(() => {});
  // Permission cards ("Ask me each time"): the decision is logged as a meta line in the chat that asked.
  const agentLogRef = useRef<(agentId: string, text: string) => void>(() => {});
  const permissions = usePermissions((owner, text) => {
    if (owner.kind === 'quest') persistMessage(owner.wsId, { kind: 'meta', text });
    else agentLogRef.current(owner.agentId, text);
  });
  const agents = useAgents({
    permissions,
    game, say,
    notify: (id, text) => persistMessage(id, { kind: 'meta', text }),
    archive: archiveAgent,
    onUnclaimed: (ev) => replayRef.current(ev),
  });
  agentLogRef.current = agents.logMeta;
  // Messages typed while Claude's run is busy wait here and go out one by one (see `drainQueue`).
  const queue = useMessageQueue();
  const projectModelRef = useRef(projectModel);
  projectModelRef.current = projectModel;
  /**
   * Sends the next queued message of a workspace when nothing is running. Only for the ACTIVE workspace,
   * because `claude:send` runs in main's active one; other workspaces keep their queue until they are active.
   * Everything it reads is synchronous (`busyNow`, the queue ref), so it can never send twice or send while busy.
   * The model is the one picked now and the permission mode is read by main when it spawns, not when queued.
   */
  const drainQueue = (id: string) => {
    if (run.busyNow() || queue.isPaused(id) || getSettings().activeId !== id) return;
    const next = queue.take(id);
    if (next) run.send(id, next.text, projectModelRef.current);
  };
  // After a run: a clean end sends the next message at once (inside the end event, so the hero never
  // falls asleep in between); Stop, an error or a rejected send pause the queue instead.
  const onRunEnd = ({ wsId: endedId, clean, stopped }: RunEnd) => {
    if (!endedId) return;
    if (clean) { drainQueue(endedId); return; }
    const waiting = queue.items(endedId).length;
    if (!waiting) return;
    queue.pause(endedId);
    persistMessage(endedId, { kind: 'meta', text: stopped
      ? `Queue paused (Stop). ${waiting} message${waiting > 1 ? 's are' : ' is'} waiting: resume or clear below the chat.`
      : 'Queue paused: the run did not finish cleanly. Resume or clear it below the chat.' });
  };
  const run = useClaudeRun({
    game, say, setStatus, stageRef: refs.stageRef, busyRef,
    observe: agents.observe, endObserved: agents.endObserved, permissions, onEnd: onRunEnd,
  });
  replayRef.current = run.replay;
  const ask = useGeneralChat();
  const panel = usePanel();

  // busy blocks UI changes; projectBusy only blocks project chat send
  // `starting` covers the gap between a send and the run's first event.
  const busy = run.running || run.starting || agents.running;
  const projectBusy = run.running || run.starting;
  busyRef.current = busy;
  // Read after an await, where the values captured by the render may be stale.
  const selectedAgentRef = useRef<string | null>(null);
  selectedAgentRef.current = agents.selectedId;

  // The hero is awake exactly while Claude or an agent is working, and sleeps once both are done.
  // (Driven by state: a ref-based check at event time is stale until the next render.)
  useEffect(() => {
    if (busy) game.wake();
    else { game.sleep(); ach.flush(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- flush is stable
  }, [busy, game]);

  // Resume, a message queued as a run ended, or switching back to a workspace with waiting messages.
  useEffect(() => {
    if (ws && !projectBusy) drainQueue(ws.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drainQueue reads refs; re-run on these changes
  }, [ws?.id, projectBusy, queue.state]);

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

  // A design that arrives for the current seed (summon) only changes how the hero looks.
  const designAt = ws?.heroDesign?.at;
  const firstDesign = useRef(true);
  useEffect(() => {
    if (firstDesign.current) { firstDesign.current = false; return; }
    if (ws) game.configure({ hero: heroFor(ws) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the design changes
  }, [designAt]);

  // HUD status for agent-only work (the main chat sets its own status per event).
  const agentCount = agents.agents.filter((a) => a.status === 'running').length;
  const wasAgentsRunning = useRef(false);
  useEffect(() => {
    if (run.running) {
      // Agents Claude delegated to run inside the Expedition run: show their count when it changes.
      if (agentCount > 0) setStatus(`⚔ ${agentCount} agent${agentCount > 1 ? 's' : ''} working…`);
      return undefined;
    }
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

  // Something is waiting for the user's OK: the HUD says so and the strip glows, so a closed panel never hides it.
  const waiting = permissions.requests.length;
  useEffect(() => {
    document.body.classList.toggle('perm-pending', waiting > 0);
    return () => document.body.classList.remove('perm-pending');
  }, [waiting]);
  const askingAgents = new Set(permissions.requests.flatMap((r) => (r.owner.kind === 'agent' ? [r.owner.agentId] : [])));

  // Level prestige (weapon glow from 10, aura from 15) follows the hero's level.
  const level = ws ? levelFor(xpFor(ws)) : 0;
  useEffect(() => { game.configure({ level }); }, [game, level, wsId, heroSeed, designAt]);

  const map = ws?.map;
  useEffect(() => {
    if (!map) return;
    game.configure({ mapId: map });
    ach.noteMap(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- noteMap is stable; the map/workspace changing is the trigger
  }, [map, wsId, game]);

  // "/<agent-name> <task>" runs that agent in its own tab and orb. Only names found under
  // .claude/agents count; skills, other slash commands and plain text are not agents.
  const startAgent = async (target: Workspace, { definition, task }: AgentInvocation, text: string, rest: AgentInvocation[] = []) => {
    persistMessage(target.id, { kind: 'user', text });
    if (agents.agents.filter((a) => a.status === 'running' && !a.observed).length >= MAX_AGENTS) {
      persistMessage(target.id, { kind: 'meta', text: `${MAX_AGENTS} agents are already working. Wait for one to finish, or stop it.` });
      return;
    }
    if (!task) {
      persistMessage(target.id, { kind: 'meta', text: `Tell ${definition.name} what to do: /${definition.name} <task>` });
      return;
    }
    say(`Summoning ${definition.name}…`, 2000);
    try {
      await agents.spawn(target, definition, task, settings.permissionMode, rest.length ? { rest, total: rest.length + 1 } : undefined);
      ach.noteAgent();
      persistMessage(target.id, { kind: 'meta', text: rest.length
        ? `Chain: ${[definition, ...rest.map((s) => s.definition)].map((d) => d.name).join(' -> ')}. ${definition.name} is working in its own tab.`
        : `${definition.name} is working in its own tab.` });
    } catch (err) {
      persistMessage(target.id, { kind: 'error', text: `Could not start ${definition.name}: ${(err as Error).message}` });
    }
  };

  // Read after an await, so it uses the hook's refs, not the render's values. Waiting messages keep their
  // order unless the queue is paused (then a typed message goes out at once, as when idle).
  const mustQueue = (id: string) => run.busyNow() || (queue.items(id).length > 0 && !queue.isPaused(id));

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
      // "/a task && /b [task]": a chain, only when every step is a known agent.
      const chain = parseAgentChain(text, definitions);
      if (chain?.tooLong) {
        persistMessage(ws.id, { kind: 'user', text });
        persistMessage(ws.id, { kind: 'meta', text: `A chain can have at most ${MAX_CHAIN_STEPS} steps. Nothing was started.` });
        return;
      }
      if (chain) {
        await startAgent(ws, chain.steps[0], text, chain.steps.slice(1));
        return;
      }
      const invocation = parseAgentInvocation(text, definitions);
      if (invocation) {
        await startAgent(ws, invocation, text);
        return;
      }
      // "/plan [task]": plan mode is the "Plan only" permission mode here, not a headless command.
      const plan = text.match(PLAN_COMMAND);
      if (plan) {
        const task = (plan[1] ?? '').trim();
        if (task && !selectedAgentRef.current && mustQueue(ws.id)) {
          // Check before changing the mode, so a refused task leaves the settings alone.
          persistMessage(ws.id, { kind: 'user', text });
          persistMessage(ws.id, { kind: 'meta', text: 'Claude is busy, so that /plan task was not sent or queued. Try again when it finishes.' });
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
    if (mustQueue(ws.id)) {
      // Claude is busy (or earlier queued messages are still ahead of this one): wait in line.
      if (!queue.add(ws.id, text)) {
        persistMessage(ws.id, { kind: 'meta', text: `The queue is full (${MAX_QUEUED} messages). That one was not queued.` });
      }
      return;
    }
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
          archive: { count: ws?.archive?.length ?? 0, open: panel.drawerOpen, toggle: () => { void panel.toggleDrawer(); } },
          permissions,
          queue: ws ? {
            items: queue.items(ws.id),
            paused: queue.isPaused(ws.id),
            onRemove: (id) => queue.remove(ws.id, id),
            onClear: () => queue.clear(ws.id),
            onResume: () => queue.resume(ws.id),
          } : undefined,
          model: projectModel, onModelChange: setProjectModel, onSend: sendProjectPrompt, onStop: stop,
        }}
        ask={{ chat: ask, model: askModel, onModelChange: setAskModel }}
        inventory={{ ws, busy, actions: workspaceActions, onPickMap: pickMap }}
      />
      <ArchiveDrawer
        open={panel.open && panel.drawerOpen}
        wsId={ws?.id ?? null}
        archive={ws?.archive ?? []}
        onClose={() => { void panel.toggleDrawer(false); }}
        onDelete={(id) => { if (ws) void deleteArchived(ws.id, id); }}
        onClear={() => { if (ws) void clearArchive(ws.id); }}
      />
      <Strip
        onTogglePanel={() => panel.toggle()}
        stageProps={{
          refs, bubble, game, dragProps,
          hasWorkspace: !!ws,
          onImport: workspaceActions.importProject,
          agents: agents.agents,
          asking: askingAgents,
        }}
        hudProps={{ ws, game, status: waiting > 0 ? `Waiting for your OK (${waiting})` : status, dragProps }}
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
