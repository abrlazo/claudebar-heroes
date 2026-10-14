const fs = require('fs');
const path = require('path');
const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, dialog, globalShortcut, Notification,
} = require('electron');
const settings = require('./settings');
const claude = require('./claude');
const agents = require('./agents');
const agentDefinitions = require('./agent-definitions');
const commandCatalog = require('./command-catalog');
const heroDesign = require('./hero-design');
const { DRAWER_EXTRA, PIPE_EXTRA, choosePanes, windowRect } = require('./drawer-layout');
const notify = require('./notify');
const visibility = require('./window-visibility');
const bubbleState = require('./bubble-state');
const bubbleGeo = require('./bubble-geometry');

// Windows shows toasts only for an app with an AppUserModelId.
if (process.platform === 'win32') app.setAppUserModelId('com.claudebar.heroes');

// The window is a transparent, frameless box that holds the hero strip. It
// can be dragged anywhere (even over the taskbar) and remembers its spot.
// Opening the chat panel grows the window upward, or downward when there
// isn't room above. While the archive drawer or the workflow pipeline pane is open the window also grows
// sideways (drawer-layout.js: left of the strip, else right, else not at all); `stripPos` never changes for it.
// Transparent areas are click-through.
const WIN_WIDTH = 560;
const STRIP_H = 96;
const DEFAULT_PANEL_HEIGHT = 500; // panel height + gap
const MARGIN = 8;

// DevTools open on launch only for `npm run dev` (--dev); otherwise use the tray menu.
const isDev = process.argv.includes('--dev');
const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
const TOGGLE_SHORTCUT = 'CommandOrControl+Shift+Space';

let win = null;
let tray = null;
let stripPos = null;       // top-left of the strip, in screen coordinates
let panelOpen = false;
let panelSide = 'above';
let drawerOpen = false;     // archive drawer beside the panel (only while the panel is open)
let drawerMode = 'left';    // 'left' | 'right' | 'overlay', chosen when it opens
let pipelineOpen = false;  // workflow pipeline pane (only while the panel is open; memory only)
let pipelineMode = 'inline'; // 'left' | 'right' | 'inline', chosen when it opens and re-chosen when the drawer or the strip moves
let dragTimer = null;
let panelHeight = DEFAULT_PANEL_HEIGHT;
let runningWsId = null;     // workspace of the Claude run in progress
let mainHandle = null;      // handle to current main Claude process
let generalChatHandle = null; // handle to general chat Claude process
let generalSessionId = null;  // general chat conversation (kept while the app runs)
// Hide / show (see applyVisibility). Memory only: the app always starts visible. Hiding needs a way back: the tray, or the bubble.
const vis = visibility.createVisibility({ trayOk: false, bubbleOk: process.env.CBH_WINDOW_NOBUBBLE !== '1', mode: 'bubble' });
let mouseIgnored = true;      // what main last set with setIgnoreMouseEvents (the window starts click-through)
let commandTimer = null;      // test seam CBH_WINDOW_COMMANDS
// The floating bubble (see "The floating bubble" below): a second small window, created at the first hide and then kept.
let bubbleWin = null;
let bubbleLoaded = false;     // its page finished loading
let bubbleWanted = false;     // main wants it on screen (set by the show-bubble effect, cleared by hide-bubble)
let bubbleOk = process.env.CBH_WINDOW_NOBUBBLE !== '1'; // false once it could not be created or was lost: the tray rule applies
let trayAvailable = false;
let bubbleTimer = null;       // the drag poll
let lastBubblePayload = '';
let bubbleDragStart = null;   // the bubble's position when a drag began
const bubbleBadge = bubbleState.createBadge();
const bubbleGesture = bubbleGeo.createGesture();

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

// Where the panes would go for the strip's current spot (measured on the display it is on). `drawerWanted` /
// `pipelineWanted` say which panes to place; the pipeline avoids the side the drawer takes (see drawer-layout.js).
function currentPanes({ drawerWanted, pipelineWanted }) {
  // Test seam (environment of the main process only, never reachable from the renderer): the simulation runs on
  // large displays where 'overlay' cannot happen, so it forces that mode.
  const drawerForced = process.env.CBH_FORCE_DRAWER_MODE === 'overlay' ? 'overlay' : undefined;
  const { workArea } = screen.getDisplayNearestPoint({ x: stripPos.x, y: stripPos.y });
  const panes = choosePanes({ stripX: stripPos.x, stripW: WIN_WIDTH, area: workArea, drawerWanted, pipelineWanted, drawerForced });
  // Second test seam: a fixed pipeline mode (bad values are ignored).
  const forced = process.env.CBH_FORCE_PIPELINE_MODE;
  if (pipelineWanted && (forced === 'left' || forced === 'right' || forced === 'inline')) panes.pipeline = forced;
  return panes;
}

function currentDrawerMode() {
  return currentPanes({ drawerWanted: true, pipelineWanted: false }).drawer;
}

// Where the pipeline would go, given whether the drawer is open (or about to be, `withDrawer`).
function currentPipelineMode(withDrawer = drawerOpen) {
  return currentPanes({ drawerWanted: withDrawer, pipelineWanted: true }).pipeline;
}

// The window grows to the left of the strip in 'left' mode, so its x is the strip's minus that.
function leftExtra() {
  if (!panelOpen) return 0;
  return (drawerOpen && drawerMode === 'left' ? DRAWER_EXTRA : 0) + (pipelineOpen && pipelineMode === 'left' ? PIPE_EXTRA : 0);
}

// The drawer or the strip changed: the pipeline may have to move to another side (or inline). Tells the renderer.
function refreshPipelineMode() {
  if (!pipelineOpen) return;
  const next = currentPipelineMode();
  if (next !== pipelineMode) {
    pipelineMode = next;
    win?.webContents.send('panel:pipelineMode', pipelineMode);
  }
}

function applyBounds() {
  if (!win) return;
  win.setBounds(windowRect({
    stripPos, stripW: WIN_WIDTH, stripH: STRIP_H, panelOpen, panelSide, panelHeight, drawerOpen, drawerMode, pipelineOpen, pipelineMode,
  }));
}

function restorePosition() {
  const saved = settings.get().windowPos;
  stripPos = saved && isOnScreen(saved) ? saved : defaultStripPos();
  applyBounds();
}

function resetPosition() {
  stripPos = defaultStripPos();
  if (drawerOpen) {
    drawerMode = currentDrawerMode();
    win?.webContents.send('panel:drawerMode', drawerMode);
  }
  refreshPipelineMode();
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

  // A reload loses the cards but not the runs: deny what is pending so nothing waits for an answer nobody can give.
  win.webContents.on('did-start-navigation', (details, ...legacy) => {
    const mainFrame = details && typeof details === 'object' && 'isMainFrame' in details ? details.isMainFrame : legacy[2];
    if (mainFrame !== true) return;
    mainHandle?.denyPending?.();
    agents.denyAllPermissions();
  });

  // A reloaded renderer starts out thinking it is visible.
  win.webContents.on('did-finish-load', () => { if (vis.hidden()) win?.webContents.send('window:visible', { visible: false }); });

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

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: visibility.trayLabel(vis.hidden()), click: () => applyVisibility('toggle', 'tray') },
    { label: 'Open Chat', accelerator: TOGGLE_SHORTCUT, click: () => togglePanel('tray') },
    { label: 'Reset Position', click: resetPosition },
    { type: 'separator' },
    { label: 'Open DevTools', click: () => win?.webContents.openDevTools({ mode: 'detach' }) },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
}

// True when the tray icon exists. Without it there would be no way back from a hidden window, so hiding is refused.
function createTray() {
  // Test seam (environment of the main process only): pretend the tray could not be created.
  if (process.env.CBH_WINDOW_NOTRAY === '1') return false;
  try {
    tray = new Tray(trayIcon());
    tray.setToolTip('Claudebar Heroes');
    tray.setContextMenu(trayMenu());
    // macOS opens the menu on a click; elsewhere a plain click toggles.
    if (process.platform !== 'darwin') tray.on('click', () => applyVisibility('toggle', 'tray'));
    return true;
  } catch (err) {
    console.error('Could not create the tray icon:', err);
    tray = null;
    return false;
  }
}

// ----- the floating bubble -----
// While the app is hidden in 'bubble' mode a small round window stays on screen. Main owns everything about it: the page
// only reports press / release / right-click, main decides click or drag, builds the menu and the badge. The page has no
// `window.bar` (own preload) and every `bubble:*` message is checked against the bubble window's own webContents.
const BUBBLE_URL = path.join(__dirname, '..', '..', 'dist', 'renderer', 'bubble.html');

function bubbleLive() { return !!bubbleWin && !bubbleWin.isDestroyed(); }
// On screen as far as main is concerned (it is wanted, hidden mode is on and the window exists).
function bubbleUp() { return bubbleLive() && bubbleWanted && vis.hidden(); }

// The bubble was closed, crashed or failed to load: from now on the old tray rule applies. Never lose the app: if it was
// the only way back (no tray), show the strip again.
function onBubbleLost() {
  const was = bubbleWin;
  bubbleWin = null;
  bubbleLoaded = false;
  bubbleWanted = false;
  stopBubblePoll();
  bubbleGesture.cancel();
  if (quitting || !was) return;
  bubbleOk = false;
  vis.setBubble(false);
  logWindow({ event: 'bubble', action: 'lost' });
  if (vis.hidden() && !vis.canHide()) applyVisibility('show', 'bubble');
}

function ensureBubble() {
  if (bubbleLive()) return true;
  if (!bubbleOk || process.env.CBH_WINDOW_NOBUBBLE === '1') { bubbleOk = false; return false; }
  try {
    const w = new BrowserWindow({
      width: bubbleGeo.BUBBLE_SIZE,
      height: bubbleGeo.BUBBLE_SIZE,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'bubble-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
      },
    });
    bubbleWin = w;
    bubbleLoaded = false;
    // A page that can never leave bubble.html or open another window.
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.webContents.on('will-redirect', (e) => e.preventDefault());
    w.webContents.on('will-attach-webview', (e) => e.preventDefault());
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('did-finish-load', () => {
      if (bubbleWin !== w) return;
      bubbleLoaded = true;
      lastBubblePayload = '';
      if (bubbleUp()) showBubbleNow();
    });
    w.webContents.on('did-fail-load', () => { if (bubbleWin === w) w.destroy(); });
    w.webContents.on('render-process-gone', () => { if (bubbleWin === w) w.destroy(); });
    w.on('closed', () => { if (bubbleWin === w || bubbleWin === null) onBubbleLost(); });
    w.loadFile(BUBBLE_URL).catch(() => { if (bubbleWin === w && !w.isDestroyed()) w.destroy(); });
    return true;
  } catch (err) {
    console.error('Could not create the bubble:', err);
    bubbleWin = null;
    bubbleOk = false;
    return false;
  }
}

const workAreas = () => screen.getAllDisplays().map((d) => d.workArea);

// Where the bubble goes: the saved spot if some display still shows it, else next to where the strip was; always inside a work area.
function bubbleSpot() {
  const areas = workAreas();
  let pos = bubbleGeo.cleanBubblePos(settings.get().bubblePos);
  if (!pos || !bubbleGeo.isShown(pos, areas)) pos = bubbleGeo.defaultBubblePos(stripPos || defaultStripPos(), WIN_WIDTH, STRIP_H, MARGIN);
  return bubbleGeo.clampBubblePos(pos, areas) || pos;
}

function pushBubble(force = false) {
  if (!bubbleLive() || !bubbleLoaded) return;
  const p = bubbleState.payload(bubbleBadge.view(), settings.get().theme);
  const json = JSON.stringify(p);
  if (!force && json === lastBubblePayload) return;
  lastBubblePayload = json;
  bubbleWin.webContents.send('bubble:state', p);
  logWindow({ event: 'bubble', action: 'state', badge: p.badge, label: p.label, theme: p.theme });
}

function logBubble(action, extra = {}) {
  if (!process.env.CBH_WINDOW_LOG) return;
  logWindow({
    event: 'bubble', action, bubbleVisible: bubbleLive() && bubbleWin.isVisible(), stripVisible: !!win && !win.isDestroyed() && win.isVisible(), ...extra,
  });
}

// Puts the bubble on screen (it is already wanted and the strip is hidden).
function showBubbleNow() {
  if (!bubbleLive() || !bubbleLoaded) return;
  const pos = bubbleSpot();
  bubbleWin.setBounds({ x: pos.x, y: pos.y, width: bubbleGeo.BUBBLE_SIZE, height: bubbleGeo.BUBBLE_SIZE });
  bubbleWin.setAlwaysOnTop(true, 'pop-up-menu');
  bubbleWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  syncBadge();
  pushBubble(true);
  bubbleWin.showInactive();
  logBubble('show', { bpos: pos });
}

function stopBubblePoll() {
  if (bubbleTimer) clearInterval(bubbleTimer);
  bubbleTimer = null;
  bubbleDragStart = null;
}

// ----- the gesture: main decides, from the cursor, whether it was a click or a drag -----
function bubblePress(point) {
  if (!bubbleUp()) return;
  stopBubblePoll();
  bubbleGesture.press(point);
  const [x, y] = bubbleWin.getPosition();
  bubbleDragStart = { x, y };
}
function bubbleMove(point) {
  if (!bubbleUp() || !bubbleDragStart) return;
  const m = bubbleGesture.move(point);
  if (!m.dragging) return;
  const x = Math.round(bubbleDragStart.x + m.dx);
  const y = Math.round(bubbleDragStart.y + m.dy);
  const [cx, cy] = bubbleWin.getPosition();
  if (x !== cx || y !== cy) bubbleWin.setPosition(x, y);
}
function bubbleRelease(point) {
  if (!bubbleUp()) { bubbleGesture.cancel(); stopBubblePoll(); return; }
  bubbleMove(point);
  const result = bubbleGesture.release();
  stopBubblePoll();
  if (result === 'click') applyVisibility('show', 'bubble');
  else if (result === 'drag') {
    // The drop spot is kept inside a work area (never under the dock or taskbar) and remembered; only main writes it.
    const [x, y] = bubbleWin.getPosition();
    const pos = bubbleGeo.clampBubblePos({ x, y }, workAreas()) || { x, y };
    bubbleWin.setPosition(pos.x, pos.y);
    settings.set({ bubblePos: pos });
    logBubble('move', { bpos: pos });
  }
}
function startBubblePoll() {
  bubbleTimer = setInterval(() => {
    if (!bubbleUp() || !bubbleGesture.active()) { stopBubblePoll(); return; }
    bubbleMove(screen.getCursorScreenPoint());
  }, 16);
}

// The right-click menu: fixed items, no text from the page.
function bubbleMenuTemplate() {
  return [
    { label: 'Show Claudebar Heroes', click: () => applyVisibility('show', 'bubble') },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ];
}
function openBubbleMenu(seamClick) {
  if (!bubbleUp()) return;
  bubbleGesture.cancel();
  stopBubblePoll();
  const template = bubbleMenuTemplate();
  if (seamClick !== undefined) { // test seam: log the labels instead of popping a native menu
    logBubble('menu', { labels: template.map((t) => t.label || '-') });
    const item = template.find((t) => t.label === seamClick);
    if (item && item.click) item.click();
    return;
  }
  Menu.buildFromTemplate(template).popup({ window: bubbleWin });
}

// Only the bubble's own page may call these; the app's window has no such channel and is rejected here anyway.
const fromBubble = (e) => bubbleLive() && e.sender === bubbleWin.webContents && bubbleUp();
function registerBubbleIpc() {
  ipcMain.on('bubble:press', (e) => {
    if (!fromBubble(e)) return;
    bubblePress(screen.getCursorScreenPoint());
    startBubblePoll();
  });
  ipcMain.on('bubble:release', (e) => { if (fromBubble(e)) bubbleRelease(screen.getCursorScreenPoint()); });
  ipcMain.on('bubble:menu', (e) => { if (fromBubble(e)) openBubbleMenu(); });
}

// Keeps the badge in step with what main already knows (trackers); display only. A request waiting for the user shows as
// "ask" even when both notification switches are off: it is a blocked run. Nothing here shows the strip or answers a card.
function syncBadge() {
  let waiting = 0;
  let running = false;
  for (const t of new Set([questTracker, ...agentTrackers.values()])) {
    if (!t) continue;
    if (!t.ended()) waiting += t.waiting();
    if (t.running()) running = true;
  }
  bubbleBadge.setWaiting(waiting);
  bubbleBadge.setRunning(running);
}
function refreshBadge() {
  syncBadge();
  if (bubbleUp()) pushBubble();
}

// ----- notifications: "work finished" / "something failed" -----
// Main decides (notify.js is the pure core) from the events it already sees; the renderer only shows the text main built
// (the hero bubble, or a small toast when the panel is open) and never supplies any. Nothing here changes a run.
const NOTIFY_TABS = ['project-chat', 'general-chat', 'settings'];
let notifier = null;
let notifyLimiter = null;
let notifyView = { tab: null, wsId: null, agentId: null }; // what the renderer shows (reported by notify:view)
let quitting = false;
let nativeBroken = false;                                  // the OS refused a notification: only the in-app cue from now on
const liveNotifications = new Set();                       // kept referenced until closed, or macOS clicks are lost
let questTracker = null;
const agentTrackers = new Map();                           // agentId -> tracker of the process that is running now
let lastWriteNotice = 0;

// Test seams (environment of the main process only, never settings or IPC; bad values are ignored).
const envNumber = (name, min) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : undefined;
};

// CBH_NOTIFY_FOCUS=1 / 0 (test seam, main's environment only) fixes the answer: the real focus depends on the desktop the test runs on.
const windowFocused = () => (process.env.CBH_NOTIFY_FOCUS === '1' ? true : process.env.CBH_NOTIFY_FOCUS === '0' ? false : !!win && !win.isDestroyed() && win.isFocused());

function showFromNotification(target) {
  if (!win || win.isDestroyed()) return;
  applyVisibility('show', 'notification');
  win.focus();
  win.webContents.send('notify:open', { wsId: target?.wsId ?? null, agentId: target?.agentId ?? null });
}

// The OS notification. True when one was (or, with the log seam, would have been) shown.
function showNative(note) {
  const logFile = process.env.CBH_NOTIFY_LOG;
  if (logFile) {
    try {
      fs.appendFileSync(logFile, `${JSON.stringify({ at: Date.now(), kind: note.kind, title: note.title, body: note.body, short: note.short, count: note.count, target: note.target })}\n`);
      return true;
    } catch { return false; }
  }
  if (nativeBroken || !Notification.isSupported()) return false;
  try {
    const n = new Notification({ title: note.title, body: note.body || '', silent: true });
    liveNotifications.add(n);
    n.on('click', () => { liveNotifications.delete(n); showFromNotification(note.target); });
    n.on('close', () => liveNotifications.delete(n));
    n.on('failed', () => { liveNotifications.delete(n); nativeBroken = true; });
    n.show();
    return true;
  } catch {
    nativeBroken = true;
    return false;
  }
}

// Always the in-app cue; the OS notification only when `native` (the user cannot see the panel anyway).
function deliverNotification(note) {
  if (quitting) return false;
  // The bubble keeps what finished or failed while the app is hidden, until the strip is shown. This follows the same
  // rules as the notification (switches, minimum length, grouping); the spam limit only governs `native`.
  if (bubbleUp() && note.counts && (note.kind === 'done' || note.kind === 'failed' || note.kind === 'mixed')) {
    bubbleBadge.latch(note.counts);
    pushBubble();
  }
  if (win && !win.isDestroyed()) {
    win.webContents.send('notify:show', { kind: note.kind, title: note.title, text: note.short, target: note.target ? { wsId: note.target.wsId, agentId: note.target.agentId } : null });
  }
  return note.native ? showNative(note) : false;
}

// Is the user looking at this very chat right now?
function watchingTarget(target) {
  if (!panelOpen || !windowFocused() || notifyView.tab !== 'project-chat') return false;
  return notifyView.wsId === target.wsId && (notifyView.agentId ?? null) === (target.agentId ?? null);
}

function setupNotifier() {
  notifyLimiter = notify.createLimiter({ max: envNumber('CBH_NOTIFY_MAX_PER_MIN', 1), dedupeMs: envNumber('CBH_NOTIFY_DEDUPE_MS', 0) });
  if (process.env.CBH_NOTIFY_OFF === '1') return; // the simulations: no tracking, no cues, nothing native
  notifier = notify.createNotifier({
    minRunMs: envNumber('CBH_NOTIFY_MIN_MS', 0),
    quietMs: envNumber('CBH_NOTIFY_QUIET_MS', 100),
    getFlags: () => ({ done: settings.get().notifyDone !== false, fail: settings.get().notifyFail !== false }),
    isBusy: () => (mainHandle?.running ? 1 : 0) + agents.getActiveAgentCount() > 0,
    watching: watchingTarget,
    canNative: () => !(panelOpen && windowFocused()),
    limiter: notifyLimiter,
    deliver: deliverNotification,
  });
  // A failed settings write is worth a notification, at most once per 10 minutes (and never while quitting).
  settings.onWriteError(() => {
    if (quitting || !notifier || Date.now() - lastWriteNotice < 10 * 60 * 1000) return;
    lastWriteNotice = Date.now();
    notifier.add(notify.systemFailure('Settings', 'settings', Date.now()));
  });
}

// A request that waits for the user's OK while the app is hidden: one native notification (fixed text, same spam limit),
// no auto-show and no auto-approve. Both notification switches off means the user opted out of notifications.
function announcePermission(tracker) {
  if (!notifier || quitting) return;
  const flags = settings.get();
  if (flags.notifyDone === false && flags.notifyFail === false) return;
  const note = tracker.permissionNote();
  if (notifyLimiter.allow(`${note.title}\n${note.body}`)) showNative(note);
}

// Hiding with a request already waiting: it was raised while the window was visible, so say it now (once per run).
function announcePendingPermissions() {
  const trackers = [questTracker, ...agentTrackers.values()].filter((t) => t && t.waiting() > 0 && !t.ended());
  for (const t of new Set(trackers)) announcePermission(t);
}

// Feeds one process's events to its tracker; it only observes and never throws into the run.
function observeRun(tracker, event) {
  if (!notifier || quitting) return;
  try {
    const early = tracker.event(event);
    if (early) notifier.add(early);
    if (event.type === 'end') notifier.add(tracker.outcome());
    if (event.type === 'permission' && vis.hidden()) announcePermission(tracker);
    refreshBadge();
  } catch { /* notifications must never break a run */ }
}
function observeAgent(tracker, agentId, event) {
  if (!notifier) return;
  if (event.type === 'start') agentTrackers.set(agentId, tracker);
  observeRun(tracker, event);
  if (event.type === 'end' && agentTrackers.get(agentId) === tracker) { agentTrackers.delete(agentId); try { refreshBadge(); } catch { /* display only */ } }
}

// The one place that hides or shows the window. The pure rules (window-visibility.js) decide and return ordered effects;
// they run here at once on the main thread, so two quick requests cannot interleave. NOTHING about a run, a chain, the
// queue, a permission request or the archive is touched: hiding only changes the window.
function applyVisibility(action, reason) {
  if (!win || win.isDestroyed()) return { changed: false, hidden: vis.hidden(), effects: [], refused: 'no-window' };
  // Follow reality before a show: if the window is not visible after all, the request must be able to show it.
  if (action !== 'hide' && !win.isVisible()) vis.sync(false);
  // The mode is read from the saved settings at every request, and the bubble is made (once) before a hide so the rules
  // know whether it can be the way back.
  vis.setMode(settings.get().minimizeTo);
  if (action !== 'show' && !vis.hidden() && vis.mode() === 'bubble') vis.setBubble(ensureBubble());
  const result = vis.request(action, reason);
  for (const effect of result.effects) {
    if (effect === 'stop-drag') {
      if (dragTimer) {
        clearInterval(dragTimer);
        dragTimer = null;
        stripPos = clampToDisplay(stripPos);
        settings.set({ windowPos: stripPos });
      }
    } else if (effect === 'close-panel') {
      panelOpen = false;
      drawerOpen = false;
      pipelineOpen = false;
      applyBounds();
    } else if (effect === 'hide-window') {
      setMouseIgnored(true);
      win.hide();
    } else if (effect === 'show-bubble') {
      bubbleWanted = true;
      if (bubbleLoaded) showBubbleNow(); // else the page's did-finish-load shows it
      else syncBadge();
    } else if (effect === 'hide-bubble') {
      bubbleWanted = false;
      bubbleBadge.clearLatched();
      bubbleGesture.cancel();
      stopBubblePoll();
      if (bubbleLive()) { bubbleWin.hide(); logBubble('hide'); }
    } else if (effect === 'place') {
      // Same rule as a display change: keep the spot if a display still shows it, else the default one. Bounds are
      // set BEFORE the window appears, so it never flashes at an old size.
      if (!isOnScreen(stripPos)) stripPos = defaultStripPos();
      applyBounds();
    } else if (effect === 'show-window') {
      win.showInactive();
    } else if (effect === 'reassert') {
      // macOS can drop these across a hide / show.
      win.setAlwaysOnTop(true, 'pop-up-menu');
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } else if (effect === 'notify-renderer') {
      win.webContents.send('window:visible', { visible: !vis.hidden() });
    }
  }
  if (result.changed && tray && !tray.isDestroyed?.()) {
    try { tray.setContextMenu(trayMenu()); } catch { /* the label is cosmetic */ }
  }
  if (result.changed && result.hidden) announcePendingPermissions();
  logWindow({ event: 'visibility', action: result.action, reason: result.reason, changed: result.changed, refused: result.refused ?? null, effects: result.effects });
  return result;
}

function setMouseIgnored(ignore) {
  mouseIgnored = ignore;
  win?.setIgnoreMouseEvents(ignore, { forward: true });
  if (process.env.CBH_WINDOW_LOG) logWindow({ event: 'click-through', ignore });
}

// Test seam: CBH_WINDOW_LOG=<file> appends one JSON line per outcome (main's environment only, never settings or IPC).
function logWindow(entry) {
  const file = process.env.CBH_WINDOW_LOG;
  if (!file) return;
  try {
    fs.appendFileSync(file, `${JSON.stringify({
      at: Date.now(), ...entry, visible: !vis.hidden(), canHide: vis.canHide(), mode: vis.mode(), panelOpen, drawerOpen, pipelineOpen, pos: stripPos, ignore: mouseIgnored,
    })}\n`);
  } catch { /* the log is only a test aid */ }
}

// Test seam: CBH_WINDOW_COMMANDS=<file> is polled every 200 ms; each new line runs the same handler the OS event would
// (an automated test cannot click the OS tray or a notification). Lines: `tray`, `shortcut`, `notify-click {"wsId":..,"agentId":..}`,
// `bubble-click {"dx":..}`, `bubble-drag {"dx":..,"dy":..}` and `bubble-menu [item label]` (only while the bubble is up).
function startCommandSeam() {
  const file = process.env.CBH_WINDOW_COMMANDS;
  if (!file) return;
  let done = 0;
  commandTimer = setInterval(() => {
    let lines;
    try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { return; }
    for (; done < lines.length; done++) {
      const [name, ...rest] = lines[done].split(' ');
      if (name === 'tray') applyVisibility('toggle', 'tray');
      else if (name === 'shortcut') togglePanel('shortcut');
      else if (name === 'notify-click') {
        let target = null;
        try { target = JSON.parse(rest.join(' ')); } catch { /* no target */ }
        showFromNotification(target);
      } else if (name === 'bubble-click' || name === 'bubble-drag') {
        // The same press / move / release path as the real gesture, with a synthetic cursor; only when the bubble is up.
        let d = {};
        try { d = JSON.parse(rest.join(' ') || '{}'); } catch { /* defaults */ }
        const dx = Number.isFinite(d.dx) ? d.dx : 0;
        const dy = Number.isFinite(d.dy) ? d.dy : 0;
        if (bubbleUp()) { bubblePress({ x: 0, y: 0 }); bubbleRelease({ x: dx, y: dy }); }
      } else if (name === 'bubble-menu') {
        openBubbleMenu(rest.join(' ') || '');
      }
    }
  }, 200);
  commandTimer.unref?.();
}

// Tray -> Open Chat and the global shortcut: show the window if hidden, focus it and toggle the panel.
function togglePanel(reason = 'shortcut') {
  if (!win) return;
  applyVisibility('show', reason);
  win.focus();
  win.webContents.send('panel:toggle');
}

function registerIpc() {
  ipcMain.handle('settings:get', () => settings.get());
  // The renderer never writes workspaces (hero seed and design) or saved designs through here:
  // those change only through the validated handlers below.
  ipcMain.handle('settings:set', (_e, patch) => {
    if (!patch || typeof patch !== 'object') return settings.get();
    // archive lives in workspaces; the notify flags only change through settings:update (booleans only); permissionMode only changes through settings:update (validated, and applied to live runs)
    // window state (hidden / visible) is never a setting: it lives in main's memory only
    const { workspaces, summonDesigns, migrations, archive, permissionMode, notifyDone, notifyFail, hidden, startHidden, visible, minimizeTo, bubblePos, ...rest } = patch;
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
  // Keep in sync with BOSSES and LEGENDARY_BOSS in src/renderer/engine/enemies.js.
  const isBossId = (id) => typeof id === 'string' && /^boss:(forest|desert|snowy|lava|night|legendary)$/.test(id);
  ipcMain.handle('workspace:trophy', (_e, id, bossId) => (
    typeof id === 'string' && isBossId(bossId) ? settings.addTrophy(id, bossId) : settings.get()
  ));
  // Keep in sync with ACHIEVEMENTS in src/renderer/lib/achievements.ts (npm run check compares them).
  const ACHIEVEMENT_IDS = [
    'first-blood', 'warm-up', 'stage-clear', 'level-2', 'combo-3', 'first-crit', 'first-agent',
    'kills-100', 'kills-500', 'level-10', 'level-15', 'combo-5', 'crits-100', 'first-boss', 'agents-10', 'maps-all',
    'kills-2500', 'kills-10000', 'level-25', 'level-45', 'bosses-all', 'boss-x10', 'agents-100', 'tokens-10m',
  ];
  ipcMain.handle('workspace:achievement', (_e, id, achId) => (
    typeof id === 'string' && typeof achId === 'string' && ACHIEVEMENT_IDS.includes(achId) ? settings.addAchievement(id, achId) : settings.get()
  ));
  ipcMain.handle('workspace:stats', (_e, id, delta) => (
    typeof id === 'string' && delta && typeof delta === 'object' ? settings.addStats(id, delta) : settings.get()
  ));
  ipcMain.handle('achievements:backfilled', () => settings.markMigration('achievementsBackfillV1'));
  ipcMain.handle('workspace:update', (_e, id, patch) => {
    const { kills, map } = patch; // the renderer may only touch map progress
    return settings.updateWorkspace(id, Object.fromEntries(
      Object.entries({ kills, map }).filter(([, v]) => v !== undefined),
    ));
  });

  ipcMain.on('window:clickThrough', (_e, ignore) => {
    if (vis.hidden() || typeof ignore !== 'boolean') return; // a hidden window stays click-through
    setMouseIgnored(ignore);
  });

  ipcMain.on('window:focus', () => { if (!vis.hidden()) win?.focus(); });

  // The renderer only asks; main decides (and refuses without a tray). There is no "show" request: a hidden window
  // cannot be clicked, so the ways back are all in main (tray, shortcut, notification click, a second launch).
  ipcMain.handle('window:hide', () => {
    const r = applyVisibility('hide', 'button');
    return r.refused ? { ok: false, reason: r.refused } : { ok: true };
  });
  ipcMain.handle('window:info', () => {
    vis.setMode(settings.get().minimizeTo);
    return { canHide: vis.canHide(), minimizeTo: vis.mode(), tray: trayAvailable, bubble: bubbleOk };
  });

  // Dragging is done by polling the cursor rather than with
  // -webkit-app-region, which doesn't mix well with click-through.
  ipcMain.on('window:dragStart', () => {
    if (!win || vis.hidden()) return;
    const cursor = screen.getCursorScreenPoint();
    const offset = { x: cursor.x - stripPos.x, y: cursor.y - stripPos.y };
    clearInterval(dragTimer);
    let lastX = null;
    let lastY = null;
    dragTimer = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      stripPos = { x: p.x - offset.x, y: p.y - offset.y };
      // Compare the final window position (the drawer can change it mid-drag), not the cursor.
      const x = stripPos.x - leftExtra();
      const y = windowY();
      if (x === lastX && y === lastY) return;
      lastX = x;
      lastY = y;
      win?.setPosition(x, y);
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
    if (drawerOpen) {
      // The strip may now sit where the drawer no longer fits on its old side.
      const next = currentDrawerMode();
      if (next !== drawerMode) {
        drawerMode = next;
        win?.webContents.send('panel:drawerMode', drawerMode);
      }
    }
    refreshPipelineMode();
    applyBounds();
    settings.set({ windowPos: stripPos });
  });

  ipcMain.handle('panel:side', () => chooseSide());

  ipcMain.handle('panel:setOpen', (_e, open) => {
    panelOpen = open === true && !vis.hidden(); // a late call cannot grow a hidden window
    if (!panelOpen) { drawerOpen = false; pipelineOpen = false; } // the drawer and the pipeline are companions of the panel
    if (panelOpen) panelSide = chooseSide();
    applyBounds();
    return panelSide;
  });

  // The renderer only asks to open or close the drawer; main decides the mode and the window rectangle.
  ipcMain.handle('panel:drawerMode', () => currentDrawerMode());

  ipcMain.handle('panel:setDrawer', (_e, open) => {
    if (open !== true && open !== false) return drawerOpen ? drawerMode : 'none';
    if (open && (!panelOpen || vis.hidden())) return 'none';
    drawerOpen = open;
    if (open) drawerMode = currentDrawerMode();
    refreshPipelineMode(); // the drawer wins the side it takes; the pipeline moves on (maybe inline)
    applyBounds();
    return drawerOpen ? drawerMode : 'none';
  });

  // Same for the workflow pipeline pane: the renderer only asks, main picks the mode and the window rectangle.
  ipcMain.handle('panel:pipelineMode', () => currentPipelineMode());

  ipcMain.handle('panel:setPipeline', (_e, open) => {
    if (open !== true && open !== false) return pipelineOpen ? pipelineMode : 'none';
    if (open && (!panelOpen || vis.hidden())) return 'none';
    pipelineOpen = open;
    if (open) pipelineMode = currentPipelineMode();
    applyBounds();
    return pipelineOpen ? pipelineMode : 'none';
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
    const permissionMode = settings.get().permissionMode;
    const tracker = notify.createTracker({ kind: 'quest', wsId: ws.id, label: ws.name });
    questTracker = tracker;
    mainHandle = claude.run(
      // Host mode always: Claude asks through the app (permission events) and the footer mode can change mid-run.
      { prompt, cwd: ws.path, sessionId: ws.sessionId, permissionMode, model, promptMode: claude.projectPromptMode(permissionMode) },
      (event) => {
        observeRun(tracker, event);
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

  // Only the user's own Stop is silent (the fail-closed cancel inside claude.js is a failure).
  ipcMain.on('claude:cancel', () => {
    if (mainHandle?.running) questTracker?.markStopped();
    mainHandle?.cancel();
  });

  // The answer to a permission card. Everything from the renderer is checked here; the tool input is never read
  // from it: the run answers from the copy it stored when Claude asked, and only for a request it holds as pending.
  ipcMain.handle('permission:answer', (_e, payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { ok: false };
    const { target, agentId, requestId, decision, message } = payload;
    if (typeof requestId !== 'string' || !requestId || requestId.length > 100) return { ok: false };
    if (decision !== 'allow' && decision !== 'deny') return { ok: false };
    // A reply (text) only exists together with a deny; an allow can never carry text. The run cleans and caps it.
    if (message !== undefined && (decision !== 'deny' || typeof message !== 'string' || message.length > 4000)) return { ok: false };
    if (target === 'quest') return { ok: !!mainHandle?.running && mainHandle.answerPermission(requestId, decision, message) };
    if (target === 'agent' && typeof agentId === 'string' && agentId && agentId.length <= 100) {
      return { ok: agents.answerPermission(agentId, requestId, decision, message) };
    }
    return { ok: false };
  });

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
    const previousMode = settings.get().permissionMode;
    if (PERMISSION_MODES.includes(patch.permissionMode)) allowed.permissionMode = patch.permissionMode;
    if (patch.theme === 'dark' || patch.theme === 'light') allowed.theme = patch.theme;
    if (typeof patch.notifyDone === 'boolean') allowed.notifyDone = patch.notifyDone;
    if (typeof patch.notifyFail === 'boolean') allowed.notifyFail = patch.notifyFail;
    if (visibility.MODES.includes(patch.minimizeTo)) allowed.minimizeTo = patch.minimizeTo; // bubblePos is never taken from the renderer
    const saved = Object.keys(allowed).length ? settings.set(allowed) : settings.get();
    if (allowed.minimizeTo) vis.setMode(allowed.minimizeTo);
    // The footer mode also applies to the processes that are working right now (main is the only source of the mode).
    if (allowed.permissionMode && allowed.permissionMode !== previousMode) {
      if (mainHandle?.running) mainHandle.setPermissionMode(allowed.permissionMode);
      agents.setPermissionModeAll(allowed.permissionMode);
    }
    return saved;
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
  ipcMain.handle('agents:run', (_e, { wsId, definitionName, displayName, task }) => {
    const ws = settings.get().workspaces.find((w) => w.id === wsId);
    if (!ws) return { error: 'Project not found.' };
    if (!task || typeof task !== 'string') return { error: 'Tell the agent what to do.' };
    if (!fs.existsSync(ws.path)) return { error: `Project folder not found: ${ws.path}` };
    const definition = agentDefinitions.findDefinition(ws.path, definitionName);
    if (!definition) return { error: `No agent named "${definitionName}" in .claude/agents.` };
    const name = typeof displayName === 'string' && displayName.trim() ? displayName.trim().slice(0, 40) : definition.name;

    const agent = settings.newAgent(name, 0);
    settings.addAgent(wsId, agent);
    const tracker = notify.createTracker({ kind: 'agent', wsId, agentId: agent.id, label: name });
    agents.spawn({
      wsId,
      agentId: agent.id,
      agentName: agent.name,
      definitionName: definition.name,
      prompt: task,
      cwd: ws.path,
      permissionMode: settings.get().permissionMode,
    }, (event) => {
      observeAgent(tracker, agent.id, event);
      win?.webContents.send('agent:event', event);
    });
    return { agent, definitionName: definition.name };
  });

  // Follow-up message to an existing agent: resume its Claude session, as the same agent.
  ipcMain.on('agents:message', (_e, { wsId, agentId, sessionId, definitionName, prompt } = {}) => {
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
    // The saved record is gone a few seconds after a run, so the label comes from the definition.
    const record = (ws.agents || []).find((a) => a.id === agentId);
    const tracker = notify.createTracker({ kind: 'agent', wsId, agentId, label: record?.name || definition?.name || 'Agent' });
    agents.spawn({
      wsId, agentId, agentName: 'Agent', definitionName: definition?.name ?? null, prompt, cwd: ws.path,
      permissionMode: settings.get().permissionMode, sessionId,
    }, (event) => {
      observeAgent(tracker, agentId, event);
      emit(event);
    });
  });

  ipcMain.handle('agents:cancel', (_e, { wsId, agentId }) => {
    // Stop and the tab's x both come here: a running agent that is stopped does not notify.
    if (agents.isRunning(agentId)) agentTrackers.get(agentId)?.markStopped();
    agents.cancelAgent(agentId);
    return settings.removeAgent(wsId, agentId);
  });

  // Archive of retired / closed agent chats (workspace.archive). The renderer owns the live logs and sends
  // a record; settings.archiveAgent rebuilds it from an allowlist and clamps every size. Each handler works
  // on ONE project by id and answers { archive } (that project's list), or null when it refuses.
  const knownWorkspace = (wsId) => (typeof wsId === 'string' ? settings.get().workspaces.find((w) => w.id === wsId) : undefined);
  ipcMain.handle('agents:archive', (_e, wsId, record) => {
    const ws = knownWorkspace(wsId);
    if (!ws || !record || typeof record !== 'object' || Array.isArray(record) || typeof record.id !== 'string') return null;
    // A running process must be stopped, not archived.
    if (agents.isRunning(record.id)) return null;
    // An agent that is live in another project cannot be archived into this one.
    if (settings.get().workspaces.some((w) => w.id !== ws.id && (w.agents || []).some((a) => a.id === record.id))) return null;
    const archive = settings.archiveAgent(ws.id, record);
    return archive ? { archive } : null;
  });
  ipcMain.handle('archive:delete', (_e, wsId, id) => {
    const ws = knownWorkspace(wsId);
    if (!ws || typeof id !== 'string') return null;
    const archive = settings.deleteArchived(ws.id, id);
    return archive ? { archive } : null;
  });
  ipcMain.handle('archive:clear', (_e, wsId) => {
    const ws = knownWorkspace(wsId);
    if (!ws) return null;
    const archive = settings.clearArchive(ws.id);
    return archive ? { archive } : null;
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

  // What the user is looking at, so main can tell a chat on screen from one that needs a notification.
  ipcMain.on('notify:view', (_e, view) => {
    if (!view || typeof view !== 'object' || Array.isArray(view)) return;
    const id = (v) => (typeof v === 'string' && v.length > 0 && v.length <= 100 ? v : null);
    notifyView = { tab: NOTIFY_TABS.includes(view.tab) ? view.tab : null, wsId: id(view.wsId), agentId: id(view.agentId) };
  });

  // The Test button: fixed text, same spam limit, ignores minimum length and "watching" (and the repeat filter).
  ipcMain.handle('notify:test', () => {
    const text = 'Notifications are on';
    const native = deliverNotification({
      kind: 'test', title: text, body: 'This is how Claudebar Heroes tells you when work finishes or fails.', short: text,
      target: null, count: 1, native: notifyLimiter.allow(text, { dedupe: false }),
    });
    return { native };
  });

  ipcMain.on('app:quit', () => app.quit());

  ipcMain.on('app:restart', () => {
    app.releaseSingleInstanceLock(); // the new process must be able to take it as soon as it starts
    app.relaunch();
    app.quit();
  });
}

// One running app per user-data folder: starting it again brings the running one back instead of opening a second
// strip. (The lock is per user-data folder, so an instance started with its own --user-data-dir is independent.)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

if (gotLock) {
  app.on('second-instance', () => { applyVisibility('show', 'second-instance'); });

  app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.hide();

    panelHeight = settings.get().panelHeight ?? DEFAULT_PANEL_HEIGHT;
    setupNotifier();
    registerIpc();
    registerBubbleIpc();
    createWindow();
    trayAvailable = createTray();
    vis.setTray(trayAvailable);
    globalShortcut.register(TOGGLE_SHORTCUT, () => togglePanel('shortcut'));
    startCommandSeam();

    const recheck = () => {
      if (!isOnScreen(stripPos)) stripPos = defaultStripPos();
      applyBounds();
      if (bubbleUp()) showBubbleNow(); // re-places the bubble inside a work area that still exists
    };
    screen.on('display-metrics-changed', recheck);
    screen.on('display-removed', recheck);
  });
}

app.on('will-quit', () => {
  if (!gotLock) return; // a second launch never loaded anything: flushing would write an empty settings file
  quitting = true; // runs cancelled below must not notify
  clearInterval(commandTimer);
  clearInterval(dragTimer);
  stopBubblePoll();
  if (bubbleLive()) bubbleWin.destroy();
  notifier?.dispose();
  globalShortcut.unregisterAll();
  mainHandle?.cancel();
  generalChatHandle?.cancel();
  agents.cancelAll();
  settings.flushSync();
});

// Keep running in the tray even if the window goes away.
app.on('window-all-closed', (e) => e.preventDefault?.());
