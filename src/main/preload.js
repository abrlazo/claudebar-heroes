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
  designSummon: (wsId, name) => ipcRenderer.invoke('summon:design', wsId, name),
  addTrophy: (id, bossId) => ipcRenderer.invoke('workspace:trophy', id, bossId),
  addAchievement: (id, achId) => ipcRenderer.invoke('workspace:achievement', id, achId),
  addStats: (id, delta) => ipcRenderer.invoke('workspace:stats', id, delta),
  achievementsBackfilled: () => ipcRenderer.invoke('achievements:backfilled'),
  updateWorkspace: (id, patch) => ipcRenderer.invoke('workspace:update', id, patch),

  setClickThrough: (ignore) => ipcRenderer.send('window:clickThrough', ignore),
  setInteracting: (on) => ipcRenderer.send('window:interacting', on === true),
  focus: () => ipcRenderer.send('window:focus'),
  dragStart: () => ipcRenderer.send('window:dragStart'),
  dragEnd: () => ipcRenderer.send('window:dragEnd'),
  panelSide: () => ipcRenderer.invoke('panel:side'),
  panelLayout: () => ipcRenderer.invoke('panel:layout'),
  setPanelOpen: (open) => ipcRenderer.invoke('panel:setOpen', open),
  drawerMode: () => ipcRenderer.invoke('panel:drawerMode'),
  setDrawerOpen: (open) => ipcRenderer.invoke('panel:setDrawer', open === true),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  windowInfo: () => ipcRenderer.invoke('window:info'),
  quit: () => ipcRenderer.send('app:quit'),
  restartApp: () => ipcRenderer.send('app:restart'),

  send: (prompt, model, imageIds) => ipcRenderer.send('claude:send', { prompt, model, imageIds }),
  stageImage: (bytes) => ipcRenderer.invoke('images:stage', { bytes }),
  discardImages: (ids) => ipcRenderer.send('images:discard', { ids }),
  cancel: () => ipcRenderer.send('claude:cancel'),
  newSession: () => ipcRenderer.invoke('claude:newSession'),
  info: () => ipcRenderer.invoke('claude:info'),

  sendGeneralChat: (prompt, model) => ipcRenderer.send('general-chat:send', { prompt, model }),
  cancelGeneralChat: () => ipcRenderer.send('general-chat:cancel'),

  commandCatalog: (wsId) => ipcRenderer.invoke('commands:list', wsId),
  agentDefinitions: (wsId) => ipcRenderer.invoke('agents:definitions', wsId),
  runAgent: (wsId, definitionName, displayName, task) => ipcRenderer.invoke('agents:run', { wsId, definitionName, displayName, task }),
  messageAgent: (wsId, agentId, sessionId, definitionName, prompt, cwd, imageIds) => ipcRenderer.send('agents:message', { wsId, agentId, sessionId, definitionName, prompt, cwd, imageIds }),
  projectHasReview: (wsId) => ipcRenderer.invoke('agents:hasReview', wsId),
  cancelAgent: (wsId, agentId) => ipcRenderer.invoke('agents:cancel', { wsId, agentId }),
  answerPermission: (target, agentId, requestId, decision, message) => ipcRenderer.invoke('permission:answer', message === undefined ? { target, agentId, requestId, decision } : { target, agentId, requestId, decision, message }),
  archiveAgent: (wsId, record) => ipcRenderer.invoke('agents:archive', wsId, record),
  deleteArchived: (wsId, id) => ipcRenderer.invoke('archive:delete', wsId, id),
  clearArchive: (wsId) => ipcRenderer.invoke('archive:clear', wsId),
  listAgents: (wsId) => ipcRenderer.invoke('agents:list', wsId),

  onClaudeEvent: (cb) => subscribe('claude:event', cb),
  onAgentEvent: (cb) => subscribe('agent:event', cb),
  onGeneralChatEvent: (cb) => subscribe('general-chat:event', cb),
  onTogglePanel: (cb) => subscribe('panel:toggle', () => cb(), () => undefined),
  onPanelLayout: (cb) => subscribe('panel:layout', cb),
  onClickThroughReset: (cb) => subscribe('window:clickThroughReset', () => cb(), () => undefined),
  onDrawerMode: (cb) => subscribe('panel:drawerMode', cb),
  addMessage: (wsId, message) => ipcRenderer.send('chat:addMessage', { wsId, message }),
  setNotifyView: (view) => ipcRenderer.send('notify:view', view),
  testNotify: () => ipcRenderer.invoke('notify:test'),
  onWindowVisible: (cb) => subscribe('window:visible', cb),
  onNotify: (cb) => subscribe('notify:show', cb),
  onNotifyOpen: (cb) => subscribe('notify:open', cb),
});
