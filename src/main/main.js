const fs = require('fs');
const path = require('path');
const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog, globalShortcut,
} = require('electron');
const settings = require('./settings');
const claude = require('./claude');
const agents = require('./agents');

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
  ipcMain.handle('settings:set', (_e, patch) => settings.set(patch));

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
  ipcMain.handle('workspace:remove', (_e, id) => (
    mainHandle?.running && id === runningWsId ? settings.get() : settings.removeWorkspace(id)
  ));
  // A summoned character is accepted only with a well-formed seed (Vader's legacy seed, or
  // "summon:<name>" with a short plain name); anything else gets a random hero.
  // Keep in sync with findSummon in src/renderer/engine/heroes.js.
  const isSummonSeed = (seed) => seed === 'secret:darth-vader' || (typeof seed === 'string' && /^summon:[a-z0-9][a-z0-9 '.-]{0,39}$/.test(seed));
  ipcMain.handle('workspace:reroll', (_e, id, seed) => settings.rerollHero(id, isSummonSeed(seed) ? seed : undefined));
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
    if (patch.panelHeight !== undefined) {
      panelHeight = Math.max(300, Math.min(1000, patch.panelHeight));
      applyBounds();
      // Only persist panel height on explicit update, not every mousemove
      if (patch.panelHeight) return settings.set({ panelHeight });
    }
    return settings.get();
  });

  ipcMain.handle('agents:spawn', (_e, { wsId, count, prompt, cwd, permissionMode }) => {
    const ws = settings.get().workspaces.find((w) => w.id === wsId);
    if (!ws) return null;

    const agentList = [];
    for (let i = 0; i < count; i++) {
      const agent = settings.newAgent(`Agent ${i + 1}`, i);
      settings.addAgent(wsId, agent);
      agentList.push(agent);

      agents.spawn({
        wsId,
        agentId: agent.id,
        agentName: agent.name,
        prompt,
        cwd,
        permissionMode,
      }, (event) => {
        win?.webContents.send('agent:event', event);
      });
    }
    return agentList;
  });

  // Follow-up message to an existing agent: resume its Claude session.
  ipcMain.on('agents:message', (_e, { wsId, agentId, sessionId, prompt, cwd, permissionMode }) => {
    if (!prompt || !sessionId) return;
    agents.spawn({
      wsId, agentId, agentName: 'Agent', prompt, cwd, permissionMode, sessionId,
    }, (event) => {
      win?.webContents.send('agent:event', event);
    });
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
