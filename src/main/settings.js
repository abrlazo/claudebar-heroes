const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');

const DEFAULTS = {
  permissionMode: 'default',
  windowPos: null,
  workspaces: [],
  activeId: null,
  theme: 'dark',
  panelHeight: 500,
};

const MAX_MESSAGES = 500;

const LEGACY_KEYS =['hero', 'background', 'cwd', 'sessionId', 'xp', 'kills'];

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });

// Each imported project gets its own hero (from `heroSeed`), progress and
// Claude session.
function newWorkspace(dir, extra = {}) {
  return {
    id: crypto.randomUUID(),
    path: dir,
    name: path.basename(dir) || dir,
    heroSeed: crypto.randomUUID(),
    usage: emptyUsage(),
    lastContext: 0,
    contextWindow: 200000,
    kills: 0,
    map: 'forest',
    sessionId: null,
    addedAt: Date.now(),
    messages: [],
    agents: [],
    ...extra,
  };
}

function newAgent(name, index) {
  return {
    id: crypto.randomUUID(),
    name: name || `Agent ${index + 1}`,
    status: 'idle',
    sessionId: null,
    messages: [],
    usage: emptyUsage(),
    startTime: null,
    endTime: null,
  };
}

function load() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch {}
  const s = { ...DEFAULTS, ...raw };

  // Older settings had a single working folder; turn it into a workspace
  // (unless it was just the home-folder default).
  if (!raw.workspaces && raw.cwd && raw.cwd !== os.homedir()) {
    const ws = newWorkspace(raw.cwd, {
      kills: raw.kills || 0,
      map: raw.background || 'forest',
      sessionId: raw.sessionId || null,
    });
    s.workspaces = [ws];
    s.activeId = ws.id;
  }
  for (const key of LEGACY_KEYS) delete s[key];
  // XP now comes from token usage; fill in fields for older workspaces.
  s.workspaces = s.workspaces.map(({ xp, ...w }) => ({
    usage: emptyUsage(), lastContext: 0, contextWindow: 200000, messages: [], agents: [], ...w,
  }));
  return s;
}

let current = null;
let writeTimer = null;

function get() {
  if (!current) current = load();
  return current;
}

function set(patch) {
  current = { ...get(), ...patch };
  debounceWrite();
  return current;
}

function debounceWrite() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushAsync();
  }, 500);
}

async function flushAsync() {
  try {
    const dir = path.dirname(file());
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file() + '.tmp';
    await fs.promises.writeFile(tmp, JSON.stringify(current));
    await fs.promises.rename(tmp, file());
  } catch (err) {
    console.error('Failed to write settings:', err);
  }
}

function flushSync() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = null;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(current));
  } catch (err) {
    console.error('Failed to flush settings:', err);
  }
}

// ----- workspaces -----

function active() {
  const s = get();
  return s.workspaces.find((w) => w.id === s.activeId) || null;
}

function updateWorkspace(id, patch) {
  const s = get();
  return set({ workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
}

function addMessage(wsId, message) {
  const s = get();
  const ws = s.workspaces.find((w) => w.id === wsId);
  if (!ws) return null;
  ws.messages = ws.messages || [];
  ws.messages.push(message);
  // The whole file is rewritten on every message; keep history bounded.
  if (ws.messages.length > MAX_MESSAGES) ws.messages.splice(0, ws.messages.length - MAX_MESSAGES);
  return set({ workspaces: s.workspaces });
}

function importWorkspace(dir) {
  const s = get();
  const existing = s.workspaces.find((w) => w.path === dir);
  if (existing) return set({ activeId: existing.id });
  const ws = newWorkspace(dir);
  return set({ workspaces: [...s.workspaces, ws], activeId: ws.id });
}

function selectWorkspace(id) {
  return get().workspaces.some((w) => w.id === id) ? set({ activeId: id }) : get();
}

function removeWorkspace(id) {
  const s = get();
  const workspaces = s.workspaces.filter((w) => w.id !== id);
  const activeId = s.activeId === id ? (workspaces[0]?.id ?? null) : s.activeId;
  return set({ workspaces, activeId });
}

// Add one model call's token usage to a workspace's lifetime total.
function addUsage(id, u) {
  const ws = get().workspaces.find((w) => w.id === id);
  if (!ws) return null;
  const usage = { ...ws.usage };
  for (const k of Object.keys(usage)) usage[k] += u[k] || 0;
  const lastContext = u.input + u.cacheRead + u.cacheCreate + u.output;
  updateWorkspace(id, { usage, lastContext });
  return { usage, lastContext };
}

// Summon a different random hero for a workspace. Progress stays.
function rerollHero(id, seed) {
  return updateWorkspace(id, { heroSeed: seed || crypto.randomUUID() });
}

function updateAgent(wsId, agentId, patch) {
  const s = get();
  const ws = s.workspaces.find((w) => w.id === wsId);
  if (!ws) return null;
  const agents = (ws.agents || []).map((a) =>(a.id === agentId ? { ...a, ...patch } : a));
  return set({ workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, agents } : w)) });
}

function addAgent(wsId, agent) {
  const s = get();
  const ws = s.workspaces.find((w) => w.id === wsId);
  if (!ws) return null;
  (ws.agents ||= []).push(agent);
  return set({ workspaces: s.workspaces });
}

function removeAgent(wsId, agentId) {
  const s = get();
  const ws = s.workspaces.find((w) => w.id === wsId);
  if (!ws) return null;
  ws.agents = (ws.agents || []).filter((a) => a.id !== agentId);
  return set({ workspaces: s.workspaces });
}

module.exports = {
  get, set, active, updateWorkspace, addUsage, importWorkspace, selectWorkspace, removeWorkspace, rerollHero,
  newAgent, updateAgent, addAgent, removeAgent, addMessage, flushSync,
};
