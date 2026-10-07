const { contextBridge, ipcRenderer } = require('electron');

// Subscribes to a main-process channel and returns an unsubscribe function,
// so React effects can clean up and listeners never accumulate.
function subscribe(channel, cb, pick = (_e, payload) => payload) {
  const listener = (...args) => cb(pick(...args));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('bar', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  importWorkspace: () => ipcRenderer.invoke('workspace:import'),
  selectWorkspace: (id) => ipcRenderer.invoke('workspace:select', id),
  removeWorkspace: (id) => ipcRenderer.invoke('workspace:remove', id),
  rerollHero: (id, seed) => ipcRenderer.invoke('workspace:reroll', id, seed),
  updateWorkspace: (id, patch) => ipcRenderer.invoke('workspace:update', id, patch),

  setClickThrough: (ignore) => ipcRenderer.send('window:clickThrough', ignore),
  focus: () => ipcRenderer.send('window:focus'),
  dragStart: () => ipcRenderer.send('window:dragStart'),
  dragEnd: () => ipcRenderer.send('window:dragEnd'),
  panelSide: () => ipcRenderer.invoke('panel:side'),
  setPanelOpen: (open) => ipcRenderer.invoke('panel:setOpen', open),
  quit: () => ipcRenderer.send('app:quit'),
  restartApp: () => ipcRenderer.send('app:restart'),

  send: (prompt, model) => ipcRenderer.send('claude:send', { prompt, model }),
  cancel: () => ipcRenderer.send('claude:cancel'),
  newSession: () => ipcRenderer.invoke('claude:newSession'),
  info: () => ipcRenderer.invoke('claude:info'),

  sendGeneralChat: (prompt, model) => ipcRenderer.send('general-chat:send', { prompt, model }),
  cancelGeneralChat: () => ipcRenderer.send('general-chat:cancel'),

  spawnAgents: (wsId, count, prompt, cwd, permissionMode) => ipcRenderer.invoke('agents:spawn', { wsId, count, prompt, cwd, permissionMode }),
  messageAgent: (wsId, agentId, sessionId, prompt, cwd, permissionMode) => ipcRenderer.send('agents:message', { wsId, agentId, sessionId, prompt, cwd, permissionMode }),
  cancelAgent: (wsId, agentId) => ipcRenderer.invoke('agents:cancel', { wsId, agentId }),
  listAgents: (wsId) => ipcRenderer.invoke('agents:list', wsId),

  onClaudeEvent: (cb) => subscribe('claude:event', cb),
  onAgentEvent: (cb) => subscribe('agent:event', cb),
  onGeneralChatEvent: (cb) => subscribe('general-chat:event', cb),
  onTogglePanel: (cb) => subscribe('panel:toggle', () => cb(), () => undefined),
  onPanelSide: (cb) => subscribe('panel:side', cb),
  addMessage: (wsId, message) => ipcRenderer.send('chat:addMessage', { wsId, message }),
});
