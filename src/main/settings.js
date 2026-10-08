const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');
const { designFor, rememberDesign } = require('./hero-design');
const { MAX_ARCHIVED, cleanArchived, cleanArchive } = require('./archive');

const DEFAULTS = {
  permissionMode: 'default',
  windowPos: null,
  workspaces: [],
  activeId: null,
  theme: 'dark',
  panelHeight: 500,
  migrations: {}, // one-time data migrations already applied (main only, never set by the renderer)
  summonDesigns: {}, // validated hero designs by summoned name (lower case), see hero-design.js
};

const MAX_MESSAGES = 500;

const LEGACY_KEYS =['hero', 'background', 'cwd', 'sessionId', 'xp', 'kills'];

function file() {
  return path.join(app.getPath('userData'), 'settings.json');
}

const MAP_IDS = ['forest', 'desert', 'snowy', 'lava', 'night'];
const MAX_ACHIEVEMENTS = 100;
const STAT_CAP = 1e9;
const emptyStats = () => ({ bestCombo: 0, crits: 0, agents: 0, mapsSeen: [] });
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
    archive: [],
    trophies: {},
    achievements: {},
    stats: emptyStats(),
    heroDesign: null,
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

// A stats object with only known numeric fields and known maps (fills older files).
function cleanStats(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const n = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(Math.floor(v), STAT_CAP)) : 0);
  return {
    bestCombo: Math.min(n(r.bestCombo), 99),
    crits: n(r.crits),
    agents: n(r.agents),
    mapsSeen: Array.isArray(r.mapsSeen) ? MAP_IDS.filter((m) => r.mapsSeen.includes(m)) : [],
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
    usage: emptyUsage(), lastContext: 0, contextWindow: 200000, messages: [], agents: [], archive: [], trophies: {}, achievements: {}, heroDesign: null, ...w,
    // No agent process survives a restart and nothing reads these stale records, so start clean.
  })).map((w) => ({ ...w, agents: [], stats: cleanStats(w.stats), archive: cleanArchive(w.archive) }));
  // One-time: bosses became rare, so every project starts with an empty trophy shelf.
  s.migrations = { ...(raw.migrations && typeof raw.migrations === 'object' && !Array.isArray(raw.migrations) ? raw.migrations : {}) };
  if (!s.migrations.trophyResetV1) {
    s.workspaces = s.workspaces.map((w) => ({ ...w, trophies: {} }));
    s.migrations.trophyResetV1 = true;
    needsFlush = true;
  }
  return s;
}

let current = null;
let needsFlush = false;
let writeTimer = null;

function get() {
  if (!current) {
    current = load();
    // Persist a migration at once so a crash cannot re-run it after new trophies are earned.
    if (needsFlush) {
      needsFlush = false;
      flushSync();
    }
  }
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

// A map boss fell: count it on the workspace's trophy shelf ({ "boss:forest": { count, firstAt } }).
function addTrophy(id, bossId) {
  const ws = get().workspaces.find((w) => w.id === id);
  if (!ws) return get();
  const old = ws.trophies?.[bossId];
  const trophies = { ...ws.trophies, [bossId]: { count: Math.min((old?.count || 0) + 1, 9999), firstAt: old?.firstAt || Date.now() } };
  return updateWorkspace(id, { trophies });
}

// An achievement was earned (the id is checked against an allowlist in main.js). Repeats are ignored, none is ever removed.
function addAchievement(id, achId) {
  const ws = get().workspaces.find((w) => w.id === id);
  if (!ws) return get();
  const old = ws.achievements && typeof ws.achievements === 'object' ? ws.achievements : {};
  if (Object.prototype.hasOwnProperty.call(old, achId) || Object.keys(old).length >= MAX_ACHIEVEMENTS) return get();
  return updateWorkspace(id, { achievements: { ...old, [achId]: { at: Date.now() } } });
}

// Counter changes reported by the renderer, clamped here: crits and agents add up, bestCombo is a max, mapsSeen merges known maps.
function addStats(id, delta) {
  const ws = get().workspaces.find((w) => w.id === id);
  if (!ws) return get();
  const old = cleanStats(ws.stats);
  const add = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(Math.floor(v), 1000)) : 0);
  const seen = Array.isArray(delta.mapsSeen) ? delta.mapsSeen : [];
  return updateWorkspace(id, { stats: cleanStats({
    bestCombo: Math.max(old.bestCombo, Number.isFinite(delta.bestCombo) ? delta.bestCombo : 0),
    crits: old.crits + add(delta.crits),
    agents: old.agents + add(delta.agents),
    mapsSeen: [...old.mapsSeen, ...seen],
  }) });
}

// Mark a one-time migration as done and write it at once (only names main knows).
function markMigration(name) {
  if (name !== 'achievementsBackfillV1') return get();
  const s = set({ migrations: { ...get().migrations, [name]: true } });
  flushSync();
  return s;
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
// A summoned name that was designed before gets its saved design back; any other seed clears the look.
function rerollHero(id, seed) {
  const name = typeof seed === 'string' && seed.startsWith('summon:') ? seed.slice('summon:'.length) : null;
  const heroDesign = name ? designFor(get().summonDesigns, name) : null;
  return updateWorkspace(id, { heroSeed: seed || crypto.randomUUID(), heroDesign });
}

// Store a design main has validated: remembered by name, and worn by the workspace if it still wears that name.
function applyDesign(id, name, design) {
  const stored = rememberDesign(get().summonDesigns, name, design);
  set({ summonDesigns: stored });
  const ws = get().workspaces.find((w) => w.id === id);
  if (ws && ws.heroSeed === `summon:${name}`) updateWorkspace(id, { heroDesign: stored[name] });
  return get();
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

// ----- archive of retired / closed agent chats (workspace.archive, newest last) -----

// Stores one cleaned chat (an older entry with the same id is replaced) and forgets the live record of that agent.
// archivedAt is set here, never taken from the renderer. Returns the workspace's archive, or null for an unknown workspace.
function archiveAgent(wsId, raw) {
  const ws = get().workspaces.find((w) => w.id === wsId);
  const record = cleanArchived(raw);
  if (!ws || !record) return null;
  record.archivedAt = Date.now();
  const archive = [...cleanArchive(ws.archive).filter((r) => r.id !== record.id), record].slice(-MAX_ARCHIVED);
  updateWorkspace(wsId, { archive });
  removeAgent(wsId, record.id);
  return archive;
}

function deleteArchived(wsId, id) {
  const ws = get().workspaces.find((w) => w.id === wsId);
  if (!ws) return null;
  const archive = cleanArchive(ws.archive).filter((r) => r.id !== id);
  updateWorkspace(wsId, { archive });
  return archive;
}

function clearArchive(wsId) {
  if (!get().workspaces.some((w) => w.id === wsId)) return null;
  updateWorkspace(wsId, { archive: [] });
  return [];
}

module.exports = {
  archiveAgent, deleteArchived, clearArchive,
  get, set, active, updateWorkspace, addTrophy, addAchievement, addStats, markMigration, addUsage, importWorkspace, selectWorkspace, removeWorkspace, rerollHero, applyDesign,
  newAgent, updateAgent, addAgent, removeAgent, addMessage, flushSync,
};
