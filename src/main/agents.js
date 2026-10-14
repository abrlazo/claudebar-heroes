const claude = require('./claude');
const settings = require('./settings');

// Manages multiple concurrent Claude agents
const agents = new Map(); // agentId -> { handle, emit }

// Starts an agent (`definitionName` = the .claude/agents file it runs as). Pass `sessionId` to continue an earlier run of the same agent
// (a follow-up message) instead of starting a fresh conversation.
function spawn({ wsId, agentId, agentName, definitionName = null, prompt, cwd, permissionMode, sessionId = null, images = [] }, onEvent) {
  if (agents.has(agentId)) {
    onEvent({ type: 'error', message: `Agent ${agentName} is already running` });
    return;
  }

  const agentEmit = (event) => {
    onEvent({ agentId, ...event });
  };

  settings.updateAgent(wsId, agentId, { status: 'running', startTime: Date.now(), sessionId });

  // Every agent process runs in host mode (the footer mode can then change while it works); main picks the mode, see main.js.
  const promptMode = claude.projectPromptMode(permissionMode);
  const handle = claude.run({ prompt, cwd, sessionId, permissionMode, agent: definitionName, promptMode, images }, (event) => {
    if (event.type === 'session') {
      settings.updateAgent(wsId, agentId, { sessionId: event.sessionId });
    } else if (event.type === 'usage') {
      const agent = settings.get().workspaces.find(w => w.id === wsId)?.agents.find(a => a.id === agentId);
      if (agent) {
        const usage = { ...agent.usage };
        for (const k of Object.keys(usage)) usage[k] += event.usage[k] || 0;
        settings.updateAgent(wsId, agentId, { usage });
      }
    } else if (event.type === 'end') {
      settings.updateAgent(wsId, agentId, { status: 'done', endTime: Date.now() });
      agents.delete(agentId);
      // Remove agent record after completion to avoid accumulation
      setTimeout(() => settings.removeAgent(wsId, agentId), 5000);
    }
    agentEmit(event);
  });

  agents.set(agentId, { handle, emit: agentEmit });
}

function cancelAgent(agentId) {
  const agent = agents.get(agentId);
  if (agent) {
    agent.handle.cancel();
    agents.delete(agentId);
  }
}

/** The user's answer to a permission request of this agent's process. False unless that request is pending there. */
function answerPermission(agentId, requestId, decision, reply) {
  const agent = agents.get(agentId);
  return !!agent && agent.handle.running && agent.handle.answerPermission(requestId, decision, reply);
}

/** The footer mode changed: every running agent process switches to it (events come back through its own emit). */
function setPermissionModeAll(mode) {
  for (const agent of agents.values()) if (agent.handle.running) agent.handle.setPermissionMode(mode);
}

/** Denies every pending permission request of every agent (the window reloaded: nobody can see the cards). */
function denyAllPermissions() {
  for (const agent of agents.values()) agent.handle.denyPending?.();
}

function isRunning(agentId) {
  return agents.has(agentId) && agents.get(agentId).handle.running;
}

function getActiveAgentCount() {
  return Array.from(agents.values()).filter(a => a.handle.running).length;
}

function cancelAll() {
  for (const agent of agents.values()) {
    agent.handle.cancel();
  }
  agents.clear();
}

module.exports = { spawn, cancelAgent, isRunning, getActiveAgentCount, cancelAll, answerPermission, setPermissionModeAll, denyAllPermissions };
