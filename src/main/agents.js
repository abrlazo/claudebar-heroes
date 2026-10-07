const claude = require('./claude');
const settings = require('./settings');

// Manages multiple concurrent Claude agents
const agents = new Map(); // agentId -> { handle, emit }

// Starts an agent (`definitionName` = the .claude/agents file it runs as). Pass `sessionId` to continue an earlier run of the same agent
// (a follow-up message) instead of starting a fresh conversation.
function spawn({ wsId, agentId, agentName, definitionName = null, prompt, cwd, permissionMode, sessionId = null }, onEvent) {
  if (agents.has(agentId)) {
    onEvent({ type: 'error', message: `Agent ${agentName} is already running` });
    return;
  }

  const agentEmit = (event) => {
    onEvent({ agentId, ...event });
  };

  settings.updateAgent(wsId, agentId, { status: 'running', startTime: Date.now(), sessionId });

  const handle = claude.run({ prompt, cwd, sessionId, permissionMode, agent: definitionName }, (event) => {
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

module.exports = { spawn, cancelAgent, isRunning, getActiveAgentCount, cancelAll };
