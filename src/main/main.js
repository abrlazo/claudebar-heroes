const fs = require('fs');
const path = require('path');
const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog, globalShortcut,
} = require('electron');
const settings = require('./settings');
const claude = require('./claude');
const agents = require('./agents');
const agentDefinitions = require('./agent-definitions');
const commandCatalog = require('./command-catalog');
const heroDesign = require('./hero-design');

// The window is a transparent, frameless box that holds the hero strip. It
// can be dragged anywhere (even over the taskbar) and remembers its spot.
// Opening the chat panel grows the window upward, or downward when there
// isn't room above. Transparent areas are click-through.
const WIN_WIDTH = 560;
const STRIP_H = 96;
const DEFAULT_PANEL_HEIGHT = 500; // panel height + gap
const MARGIN = 8;

// DevTools open on launch only for `npm run dev` (--dev); otherwise use the tray menu.
const isDev = process.argv.includes('--dev');
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
// A mode from the renderer only counts when it is on the list; otherwise the saved one applies.
const safeMode = (mode) => (PERMISSION_MODES.includes(mode) ? mode : settings.get().permissionMode);
const TOGGLE_SHORTCUT = 'CommandOrControl+Shift+Space';

let win = null;
let tray = null;
let stripPos = null;       // top-left of the strip, in screen coordinates
let panelOpen = false;
let panelSide = 'above';
let dragTimer = null;
let panelHeight = DEFAULT_PANEL_HEIGHT;
let runningWsId = null;     // workspace of the Claude run in progress
let mainHandle = null;      // handle to current main Claude process
let generalChatHandle = null; // handle to general chat Claude process
let generalSessionId = null;  // general chat conversation (kept while the app runs)

function defaultStripPos() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: workArea.x + workArea.width - WIN_WIDTH - MARGIN,
    y: workArea.y + workArea.height - STRIP_H - MARGIN,
  };
}

// True if a decent chunk of the strip is on some display.
function isOnScreen({ x, y }) {
  return screen.getAllDisplays().some(({ bounds: b }) => {
    const w = Math.min(x + WIN_WIDTH, b.x + b.width) - Math.max(x, b.x);
    const h = Math.min(y + STRIP_H, b.y + b.height) - Math.max(y, b.y);
    return w >= 80 && h >= 40;
  });
}

// Keep the whole strip inside the display it's mostly on.
function clampToDisplay({ x, y }) {
  const { bounds: b } = screen.getDisplayNearestPoint({ x: x + WIN_WIDTH / 2, y: y + STRIP_H / 2 });
  return {
    x: Math.round(Math.min(Math.max(x, b.x), b.x + b.width - WIN_WIDTH)),
    y: Math.round(Math.min(Math.max(y, b.y), b.y + b.height - STRIP_H)),
  };
}

function chooseSide() {
  const { workArea } = screen.getDisplayNearestPoint({ x: stripPos.x, y: stripPos.y });
  return stripPos.y - panelHeight >= workArea.y ? 'above' : 'below';
}

function windowY() {
  return panelOpen && panelSide === 'above' ? stripPos.y - panelHeight : stripPos.y;
}

function applyBounds() {
  if (!win) return;
  win.setBounds({
    x: stripPos.x,
    y: windowY(),
    width: WIN_WIDTH,
    height: panelOpen ? STRIP_H + panelHeight : STRIP_H,
  });
}

function restorePosition() {
  const saved = settings.get().windowPos;
  stripPos = saved && isOnScreen(saved) ? saved : defaultStripPos();
  applyBounds();
}

function resetPosition() {
  stripPos = defaultStripPos();
  settings.set({ windowPos: null });
  applyBounds();
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_WIDTH,
    height: STRIP_H,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Above the dock / taskbar so the strip can sit on top of it.
  win.setAlwaysOnTop(true, 'pop-up-menu');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  restorePosition();

  // The React renderer is bundled by Vite into dist/renderer (see vite.config.js).
  win.loadFile(path.join(__dirname, '..', '..', 'dist', 'renderer', 'index.html'));

  if (isDev) win.webContents.openDevTools({ mode: 'detach' });

  win.on('closed', () => { win = null; });
}

function trayIcon() {
  // 16x16 purple badge drawn in code so we don't need a PNG asset yet.
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside = x > 1 && x < 14 && y > 1 && y < 14 && !((x === 2 || x === 13) && (y === 2 || y === 13));
      const sword = (x === 7 || x === 8) && y > 3 && y < 12 || (y === 9 && x > 4 && x < 11);
      // BGRA
      if (sword) buf.set([255, 255, 255, 255], i);
      else if (inside) buf.set([0xea, 0x7e, 0x66, 255], i);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function createTray() {
  tray = new Tray(trayIcon());
  tray.setToolTip('Claudebar Heroes');
  const menu = Menu.buildFromTemplate([
    { label: 'Show / Hide', click: toggleVisible },
    { label: 'Open Chat', accelerator: TOGGLE_SHORTCUT, click: togglePanel },
    { label: 'Reset Position', click: resetPosition },
    { type: 'separator' },
    { label: 'Open DevTools', click: () => win?.webContents.openDevTools({ mode: 'detach' }) },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
  tray.setContextMenu(menu);
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else win.showInactive();
}

function togglePanel() {
  if (!win) return;
  if (!win.isVisible()) win.showInactive();
  win.focus();
  win.webContents.send('panel:toggle');
}

function registerIpc() {
  ipcMain.handle('settings:get', () => settings.get());
  // The renderer never writes workspaces (hero seed and design) or saved designs through here:
  // those change only through the validated handlers below.
  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return settings.get();
    const { workspaces, summonDesigns, migrations, ...rest } = patch;
    return settings.set(rest);
  });

  // ----- workspaces: each imported project gets its own random hero -----

  ipcMain.handle('workspace:import', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Import a project',
      buttonLabel: 'Import',
      properties: ['openDirectory'],
      defaultPath: settings.active()?.path,
    });
    if (result.canceled || !result.filePaths[0]) return null;
    if (mainHandle?.running) return settings.get();
    return settings.importWorkspace(result.filePaths[0]);
  });

  ipcMain.handle('workspace:select', (_e, id) => (mainHandle?.running ? settings.get() : settings.selectWorkspace(id)));
  // Any workspace can be removed, except the one Claude is working in right now.
  const forgetWorkspace = (id) => {
    const ws = settings.get().workspaces.find((w) => w.id === id);
    if (ws) claudeCommandCache.delete(ws.path);
    return settings.removeWorkspace(id);
  };
  ipcMain.handle('workspace:remove', (_e, id) => (
    mainHandle?.running && id === runningWsId ? settings.get() : forgetWorkspace(id)
  ));
  // A summoned character is accepted only with a well-formed seed (Vader's legacy seed, or
  // "summon:<name>" with a short plain name); anything else gets a random hero.
  // Keep in sync with findSummon in src/renderer/engine/heroes.js.
  const SUMMON_NAME_RE = /^[a-z0-9][a-z0-9 '.-]{0,39}$/;
  const isSummonName = (name) => typeof name === 'string' && SUMMON_NAME_RE.test(name);
  const isSummonSeed = (seed) => seed === 'secret:darth-vader' || (typeof seed === 'string' && seed.startsWith('summon:') && isSummonName(seed.slice(7)));
  // The renderer sends only a seed. A saved design is attached by settings.rerollHero from what main validated earlier.
  ipcMain.handle('workspace:reroll', (_e, id, seed) => settings.rerollHero(id, isSummonSeed(seed) ? seed : undefined));

  // Ask Claude (no tools, cheap model, neutral folder, short timeout) to design the look of a summoned name.
  // The answer is validated here (hero-design.js) and only then saved; the renderer can't supply a design.
  const designing = new Set();
  ipcMain.handle('summon:design', async (_e, wsId, name) => {
    if (typeof wsId !== 'string' || !isSummonName(name)) return { ok: false, reason: 'invalid request' };
    const exists = () => settings.get().workspaces.some((w) => w.id === wsId);
    if (!exists()) return { ok: false, reason: 'invalid request' };
    if (heroDesign.designFor(settings.get().summonDesigns, name)) {
      return { ok: true, cached: true, settings: settings.applyDesign(wsId, name, heroDesign.designFor(settings.get().summonDesigns, name)) };
    }
    if (designing.has(name)) return { ok: false, reason: 'busy' };
    designing.add(name);
    try {
      const cwd = path.join(app.getPath('userData'), 'summon-cwd');
      fs.mkdirSync(cwd, { recursive: true });
      const timeoutMs = Number(process.env.HERO_DESIGN_TIMEOUT_MS) || 25000;
      const answer = await claude.ask({ prompt: heroDesign.designPrompt(name), cwd, model: 'haiku', timeoutMs });
      if (!answer.ok) return { ok: false, reason: answer.error === 'not-found' ? 'Claude not found' : answer.error === 'timeout' ? 'timeout' : 'Claude failed' };
      const checked = heroDesign.validateDesign(heroDesign.parseDesignText(answer.text));
      if (!checked.ok) return { ok: false, reason: checked.reason };
      return { ok: true, settings: settings.applyDesign(wsId, name, checked.design) };
    } catch {
      return { ok: false, reason: 'Claude failed' };
    } finally {
      designing.delete(name);
    }
  });
  // Keep in sync with BOSSES in src/renderer/engine/enemies.js.
  const isBossId = (id) => typeof id === 'string' && /^boss:(forest|desert|snowy|lava|night)$/.test(id);
  ipcMain.handle('workspace:trophy', (_e, id, bossId) => (
    typeof id === 'string' && isBossId(bossId) ? settings.addTrophy(id, bossId) : settings.get()
  ));
  ipcMain.handle('workspace:update', (_e, id, patch) => {
    const { kills, map } = patch; // the renderer may only touch map progress
    return settings.updateWorkspace(id, Object.fromEntries(
      Object.entries({ kills, map }).filter(([, v]) => v !== undefined),
    ));
  });

  ipcMain.on('window:clickThrough', (_e, ignore) => {
    win?.setIgnoreMouseEvents(ignore, { forward: true });
  });

  ipcMain.on('window:focus', () => win?.focus());

  // Dragging is done by polling the cursor rather than with
  // -webkit-app-region, which doesn't mix well with click-through.
  ipcMain.on('window:dragStart', () => {
    if (!win) return;
    const cursor = screen.getCursorScreenPoint();
    const offset = { x: cursor.x - stripPos.x, y: cursor.y - stripPos.y };
    clearInterval(dragTimer);
    dragTimer = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      stripPos = { x: p.x - offset.x, y: p.y - offset.y };
      win?.setPosition(stripPos.x, windowY());
    }, 16);
  });

  ipcMain.on('window:dragEnd', () => {
    if (!dragTimer) return;
    clearInterval(dragTimer);
    dragTimer = null;
    stripPos = clampToDisplay(stripPos);
    if (panelOpen) {
      panelSide = chooseSide();
      win?.webContents.send('panel:side', panelSide);
    }
    applyBounds();
    settings.set({ windowPos: stripPos });
  });

  ipcMain.handle('panel:side', () => chooseSide());

  ipcMain.handle('panel:setOpen', (_e, open) => {
    panelOpen = open;
    if (open) panelSide = chooseSide();
    applyBounds();
    return panelSide;
  });

  ipcMain.on('claude:send', (_e, payload) => {
    // Accept the old string form too.
    const { prompt, model } = typeof payload === 'string' ? { prompt: payload } : (payload || {});
    const ws = settings.active();
    const emit = (event) => win?.webContents.send('claude:event', event);
    if (!prompt) return;
    if (mainHandle?.running) {
      emit({ type: 'error', message: 'Claude is already working on something.' });
      return;
    }
    if (!ws) {
      emit({ type: 'error', message: 'Import a project first.' });
      return;
    }
    if (!fs.existsSync(ws.path)) {
      emit({ type: 'error', message: `Project folder not found: ${ws.path}` });
      return;
    }
    runningWsId = ws.id;
    mainHandle = claude.run(
      { prompt, cwd: ws.path, sessionId: ws.sessionId, permissionMode: settings.get().permissionMode, model },
      (event) => {
        // Everything is saved to the workspace that started the run.
        if (event.sessionId) settings.updateWorkspace(ws.id, { sessionId: event.sessionId });
        if (event.type === 'result' && event.contextWindow) {
          settings.updateWorkspace(ws.id, { contextWindow: event.contextWindow });
        }
        if (event.type === 'usage') {
          // Leveling: XP is earned from the context Claude uses. Send the
          // workspace's new lifetime totals along with this call's usage.
          const saved = settings.addUsage(ws.id, event.usage);
          if (saved) Object.assign(event, { totals: saved.usage, lastContext: saved.lastContext });
        }
        emit({ ...event, wsId: ws.id });
      },
    );
  });

  ipcMain.on('claude:cancel', () => mainHandle?.cancel());

  ipcMain.on('general-chat:send', (_e, { prompt, model } = {}) => {
    const emit = (event) => win?.webContents.send('general-chat:event', event);
    if (!prompt || generalChatHandle?.running) return;
    const os = require('os');
    // Run in home directory for general chat (not project-scoped)
    // Use 'plan' mode to disable tool execution for pure conversational AI.
    // Resume the previous general session so follow-ups keep context.
    generalChatHandle = claude.run(
      { prompt, cwd: os.homedir(), sessionId: generalSessionId, permissionMode: 'plan', model },
      (event) => {
        if (event.sessionId) generalSessionId = event.sessionId;
        emit(event);
      },
    );
  });

  ipcMain.on('general-chat:cancel', () => generalChatHandle?.cancel());

  ipcMain.handle('claude:newSession', () => {
    const ws = settings.active();
    // Clear the saved chat too, or it reappears on the next reload.
    return ws ? settings.updateWorkspace(ws.id, { sessionId: null, messages: [], lastContext: 0 }) : settings.get();
  });

  ipcMain.handle('claude:info', () => ({ bin: claude.resolveClaudeBinary() }));

  ipcMain.handle('settings:update', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return settings.get();
    const allowed = {};
    if (Number.isFinite(patch.panelHeight)) {
      panelHeight = Math.max(300, Math.min(1000, patch.panelHeight));
      applyBounds();
      allowed.panelHeight = panelHeight;
    }
    // Other preferences the renderer may persist (the permission mode is read by every run).
    if (PERMISSION_MODES.includes(patch.permissionMode)) allowed.permissionMode = patch.permissionMode;
    if (patch.theme === 'dark' || patch.theme === 'light') allowed.theme = patch.theme;
    return Object.keys(allowed).length ? settings.set(allowed) : settings.get();
  });

  // Everything that can follow a "/" in the chat (agents, skills, custom commands), for the suggestion popup.
  // Claude's own command list is cached per project for a minute (and shared by concurrent callers)
  // so the popup opens instantly; reading it spawns a short-lived `claude` (no model call).
  const claudeCommandCache = new Map(); // project path -> { at, promise }
  const claudeCommandsFor = (projectPath) => {
    const hit = claudeCommandCache.get(projectPath);
    if (hit && Date.now() - hit.at < 60000) return hit.promise;
    const promise = claude.listCommands(projectPath);
    claudeCommandCache.set(projectPath, { at: Date.now(), promise });
    promise.then((list) => { if (!list) claudeCommandCache.delete(projectPath); });
    return promise;
  };
  ipcMain.handle('commands:list', async (_e, wsId) => {
    const ws = settings.get().workspaces.find((w) => w.id === wsId);
    if (!ws) return [];
    return commandCatalog.listCatalog(ws.path, await claudeCommandsFor(ws.path));
  });

  // The agents a project can invoke with "/<name>": markdown files under .claude/agents/.
  ipcMain.handle('agents:definitions', (_e, wsId) => {
    const ws = settings.get().workspaces.find((w) => w.id === wsId);
    return ws ? agentDefinitions.listDefinitions(ws.path) : [];
  });

  // Chains: does the project hold the review agent's findings file? The path comes from the workspace.
  ipcMain.handle('agents:hasReview', (_e, wsId) => {
    const ws = settings.get().workspaces.find((w) => w.id === wsId);
    if (!ws || typeof ws.path !== 'string') return false;
    try { return fs.statSync(path.join(ws.path, '.claude', 'review.md')).isFile(); } catch { return false; }
  });

  // "/<agent> <task>": runs ONE agent in its own process (its own tab and orb in the UI).
  // The name must match a definition under .claude/agents/; anything else is refused.
  ipcMain.handle('agents:run', (_e, { wsId, definitionName, displayName, task, permissionMode }) => {
    const ws = settings.get().workspaces.find((w) => w.id === wsId);
    if (!ws) return { error: 'Project not found.' };
    if (!task || typeof task !== 'string') return { error: 'Tell the agent what to do.' };
    if (!fs.existsSync(ws.path)) return { error: `Project folder not found: ${ws.path}` };
    const definition = agentDefinitions.findDefinition(ws.path, definitionName);
    if (!definition) return { error: `No agent named "${definitionName}" in .claude/agents.` };
    const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 40) : definition.name;

    const agent = settings.newAgent(name, 0);
    settings.addAgent(wsId, agent);
    agents.spawn({
      wsId,
      agentId: agent.id,
      agentName: agent.name,
      definitionName: definition.name,
      prompt: task,
      cwd: ws.path,
      permissionMode: safeMode(permissionMode),
    }, (event) => {
      win?.webContents.send('agent:event', event);
    });
    return { agent, definitionName: definition.name };
  });

  // Follow-up message to an existing agent: resume its Claude session, as the same agent.
  ipcMain.on('agents:message', (_e, { wsId, agentId, sessionId, definitionName, prompt, permissionMode } = {}) => {
    if (!prompt || typeof sessionId !== 'string' || !sessionId) return;
    const ws = settings.get().workspaces.find((w) => w.id === wsId);
    if (!ws) return;
    const emit = (event) => win?.webContents.send('agent:event', event);
    const definition = definitionName ? agentDefinitions.findDefinition(ws.path, definitionName) : null;
    if (definitionName && !definition) {
      // The file was deleted or renamed: don't silently resume as a plain run under the agent's name.
      emit({ agentId, type: 'error', message: `Agent definition "${definitionName}" is gone from .claude/agents.` });
      return;
    }
    agents.spawn({
      wsId, agentId, agentName: 'Agent', definitionName: definition?.name ?? null, prompt, cwd: ws.path,
      permissionMode: safeMode(permissionMode), sessionId,
    }, emit);
  });

  ipcMain.handle('agents:cancel', (_e, { wsId, agentId }) => {
    agents.cancelAgent(agentId);
    return settings.removeAgent(wsId, agentId);
  });

  ipcMain.handle('agents:list', (_e, wsId) => {
    const ws = settings.get().workspaces.find((w) => w.id === wsId);
    return ws?.agents || [];
  });

  ipcMain.on('chat:addMessage', (_e, { wsId, message } = {}) => {
    if (!wsId || !message || typeof message.kind !== 'string') return;
    try {
      settings.addMessage(wsId, message);
    } catch (err) {
      console.error('Failed to save chat message:', err);
    }
  });

  ipcMain.on('app:quit', () => app.quit());

  ipcMain.on('app:restart', () => {
    app.relaunch();
    app.quit();
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') app.dock?.hide();

  panelHeight = settings.get().panelHeight ?? DEFAULT_PANEL_HEIGHT;
  registerIpc();
  createWindow();
  createTray();
  globalShortcut.register(TOGGLE_SHORTCUT, togglePanel);

  const recheck = () => {
    if (!isOnScreen(stripPos)) stripPos = defaultStripPos();
    applyBounds();
  };
  screen.on('display-metrics-changed', recheck);
  screen.on('display-removed', recheck);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  mainHandle?.cancel();
  generalChatHandle?.cancel();
  agents.cancelAll();
  settings.flushSync();
});

// Keep running in the tray even if the window goes away.
app.on('window-all-closed', (e) => e.preventDefault?.());
