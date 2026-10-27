// Focused simulation of "hide the app": the real app in an isolated user-data folder, driven over the Chrome DevTools
// protocol, with the fake claude of tools/fake-notify.mjs (runs) and tools/fake-perm.mjs (permission cards).
// Test seams (main's environment only): CBH_WINDOW_LOG (one JSON line per hide/show and per click-through change),
// CBH_WINDOW_COMMANDS (lines `tray`, `shortcut`, `notify-click {...}` run the very handlers the OS events call: a test
// cannot click the real tray or a real notification), CBH_WINDOW_NOTRAY=1, CBH_NOTIFY_LOG (native notifications).
// Floating bubble seams (main's environment only): CBH_WINDOW_NOBUBBLE=1 (the bubble cannot be made), and the command lines
// `bubble-click {"dx":..}`, `bubble-drag {"dx":..,"dy":..}`, `bubble-menu [item]` (the real gesture path with a synthetic cursor);
// the log also gets `bubble` lines (show / hide / move / state / menu). The bubble page is reached over CDP like the app.
// Covers: the buttons, hide closing the panel and drawer, idempotence, runs/agents/queue/failures going on while hidden,
// the permission notification, every way back (tray, shortcut, notification click, a second launch), the position,
// no persistence, no tray, the paused loop, click-through after a show, the single-instance lock and screenshots.
//
// Usage: npm run simulate:window [-- --out <screenshot-dir>]   (builds first). Exit code 1 if a check fails.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = createRequire(import.meta.url)('electron');
const outFlag = process.argv.indexOf('--out');
const outDir = outFlag > -1 ? path.resolve(process.argv[outFlag + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-window-shots-'));
fs.mkdirSync(outDir, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-windowsim-'));
let port = 9600 + Math.floor(Math.random() * 90);

const fake = path.join(work, 'fake-claude.sh');
fs.writeFileSync(fake, `#!/bin/bash\nexec "$FAKE_NODE" "${path.join(root, 'tools', 'fake-notify.mjs')}" "$@"\n`, { mode: 0o755 });
const fakePerm = path.join(work, 'fake-perm.sh');
fs.writeFileSync(fakePerm, `#!/bin/bash\nexec "$FAKE_NODE" "${path.join(root, 'tools', 'fake-perm.mjs')}" "$@"\n`, { mode: 0o755 });
const logFile = path.join(work, 'notify.log');
const winLog = path.join(work, 'window.log');
const cmdFile = path.join(work, 'commands.txt');
const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

const project = path.join(work, 'project');
fs.mkdirSync(path.join(project, '.claude', 'agents'), { recursive: true });
for (const n of ['alpha', 'beta']) fs.writeFileSync(path.join(project, '.claude', 'agents', `${n}.md`), `---\nname: ${n}\ndescription: Simulated ${n} agent\n---\n\nYou are ${n}.\n`);
const userData = path.join(work, 'userData');
fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  permissionMode: 'default', windowPos: { x: 100, y: 400 }, theme: 'dark', panelHeight: 500, activeId: 'notify-ws',
  workspaces: [{
    id: 'notify-ws', path: project, name: 'notifysim', heroSeed: 'notify-seed',
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }, lastContext: 0, contextWindow: 200000,
    kills: 0, map: 'forest', sessionId: null, messages: [], agents: [],
  }],
}));

let connectionLost = null;
const pendingCalls = new Map();
const loseConnection = (why) => {
  if (connectionLost) return;
  connectionLost = why;
  console.log(`FAIL  lost the app: ${why}`);
  for (const reject of pendingCalls.values()) reject(new Error(why));
  pendingCalls.clear();
};
// Only processes whose command line carries THIS run's private user-data folder (a fresh temp dir) are ever stopped, by pid.
const ownPids = () => {
  const out = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).stdout || '';
  return out.split('\n').filter((l) => l.includes(`--user-data-dir=${userData}`)).map((l) => Number(l.trim().split(/\s+/)[0])).filter((n) => Number.isInteger(n) && n !== process.pid);
};
const killOwn = async () => {
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    for (const pid of ownPids()) { try { process.kill(pid, sig); } catch { /* already gone */ } }
    await new Promise((r) => setTimeout(r, 800));
    if (!ownPids().length) return;
  }
};
const stopping = new WeakSet();
let app; let ws; let send;
let bws = null; // CDP socket of the bubble page
let bsend = null;
let relaunching = false;
const launch = (env = {}) => {
  const child = spawn(electronBin, [root, `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
    env: { ...process.env, CLAUDE_BIN: fake, FAKE_NODE: process.execPath, CBH_NOTIFY_LOG: logFile, CBH_WINDOW_LOG: winLog, CBH_WINDOW_COMMANDS: cmdFile, CBH_FORCE_DRAWER_MODE: 'overlay', CBH_NOTIFY_MIN_MS: '2000', CBH_NOTIFY_QUIET_MS: '300', CBH_NOTIFY_MAX_PER_MIN: '100', CBH_NOTIFY_DEDUPE_MS: '0', CBH_NOTIFY_FOCUS: '0', ...env }, stdio: 'ignore',
  });
  child.on('exit', (code, signal) => { if (!stopping.has(child) && !relaunching) loseConnection(`the app exited by itself (code ${code}, signal ${signal})`); });
  child.on('error', (e) => loseConnection(`the app could not start: ${e.message}`));
  return child;
};
const stopApp = () => {
  if (ws) { stopping.add(ws); try { ws.close(); } catch { /* already closed */ } ws = undefined; }
  if (bws) { try { bws.close(); } catch { /* closed */ } bws = null; }
  if (app) { stopping.add(app); app.kill(); }
};
const pageErrors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://localhost:${port}/json`)).json();
      const page = list.find((p) => p.type === 'page' && !/bubble\.html$/.test(p.url));
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch { /* not up yet */ }
    await sleep(500);
  }
  if (!ws) throw new Error('app did not start');
  let id = 0; const pending = new Map();
  const socket = ws;
  socket.onclose = () => { if (!stopping.has(socket)) loseConnection('the DevTools connection closed'); };
  socket.onerror = () => { if (!stopping.has(socket)) loseConnection('the DevTools connection failed'); };
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') pageErrors.push(d.params.exceptionDetails?.text || 'exception'); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); pendingCalls.delete(d.id); } };
  await Promise.race([new Promise((r) => { ws.onopen = r; }), sleep(15000).then(() => { throw new Error('the DevTools connection did not open'); })]);
  send = (method, params = {}) => new Promise((r, rej) => {
    if (connectionLost) { rej(new Error(connectionLost)); return; }
    const i = ++id;
    pending.set(i, r);
    pendingCalls.set(i, rej);
    try { socket.send(JSON.stringify({ id: i, method, params })); } catch (e) { rej(new Error(`DevTools send failed: ${e.message}`)); }
  });
  await send('Runtime.enable');
}
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value;
const evAsync = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(s.result.data, 'base64'));
};
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; };
const click = (selector) => ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
const type = (text) => ev(`(()=>{const t=document.querySelector("#tab-project-chat textarea");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(text)});
  t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const sendText = async (text) => { await type(text); await sleep(120); await click('#tab-project-chat .send'); };
// While Claude is busy there is no Send button: Enter queues the message.
const queueText = async (text) => {
  await type(text);
  await sleep(120);
  await ev('document.querySelector("#tab-project-chat textarea").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))');
};
const winLines = () => readLines(winLog).map((l) => JSON.parse(l));
const vlines = () => winLines().filter((l) => l.event === 'visibility');
const command = (line) => fs.appendFileSync(cmdFile, `${line}\n`);
const notes = () => readLines(logFile).map((l) => JSON.parse(l));
const asleep = async () => ev('document.getElementById("hero").classList.contains("sleeping")');
const idle = (ms = 20000) => until(asleep, ms);
const logText = () => ev('document.querySelector("#tab-project-chat .msg-log")?.innerText || ""');
const bubbleText = () => ev('document.getElementById("bubble")?.textContent || ""');
const panelOpen = () => ev('!document.getElementById("panel").classList.contains("hidden")');
const setPanel = async (open) => { if ((await panelOpen()) !== open) { await click('#toggle-panel'); await sleep(800); } };
const clickTab = (label) => ev(`[...document.querySelectorAll(".panel-tabs .tab")].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
const settingsNow = () => evAsync('window.bar.getSettings().then(s=>JSON.stringify({d:s.notifyDone,f:s.notifyFail}))');
const waitNotes = (n, ms = 15000) => until(() => notes().length >= n, ms);
const tabCount = (prefix) => ev(`[...document.querySelectorAll(".agent-tab")].filter(t=>(t.childNodes[0]?.textContent||"").trim().startsWith(${JSON.stringify(prefix)})).length`);
const cue = () => ev('JSON.stringify({ n: document.querySelectorAll(".notify-cue").length, text: document.querySelector(".notify-cue")?.innerText || "", cls: document.querySelector(".notify-cue")?.className || "" })').then(JSON.parse);
const waitCue = (ms = 12000) => until(async () => (await cue()).n === 1, ms);
const lightTheme = async (on) => { await ev(`document.body.classList.toggle("theme-light", ${on});document.body.classList.toggle("theme-dark", ${!on})`); await sleep(900); };

const restart = async (env, { rewrite } = {}) => {
  stopApp();
  await killOwn(); // also an app that relaunched itself (it is not our child); only this run's own user-data folder matches
  await sleep(1200);
  if (rewrite) rewrite();
  port += 1;
  app = launch(env);
  await connect();
  await sleep(1500);
};
const settingsFile = path.join(userData, 'settings.json');
const hiddenNow = () => ev('document.body.classList.contains("app-hidden")');
const drawerNow = () => ev('document.body.classList.contains("drawer-open")');
const lastV = () => vlines().at(-1) ?? {};
const waitV = (n, ms = 8000) => until(() => vlines().length >= n, ms);
const center = (sel) => ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}})()`);
const mouse = async (type, p) => send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
const cleanFiles = () => { for (const f of [logFile, winLog, cmdFile]) fs.rmSync(f, { force: true }); };
const hideViaButton = async () => { const n = vlines().length; await click('#hide-app'); return waitV(n + 1); };
const showViaTray = async () => { const n = vlines().length; command('tray'); return waitV(n + 1); };

// ----- the bubble page over CDP -----
const bubbleLog = () => winLines().filter((l) => l.event === 'bubble');
const bubbleLast = (action) => bubbleLog().filter((l) => l.action === action).at(-1);
const bubbleCount = (action) => bubbleLog().filter((l) => l.action === action).length;
const bubbleConnect = async () => {
  if (bws && bws.readyState === 1) return;
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://localhost:${port}/json`)).json();
      const page = list.find((p) => p.type === 'page' && /bubble\.html$/.test(p.url));
      if (page) {
        const socket = new WebSocket(page.webSocketDebuggerUrl);
        let id = 0; const pending = new Map();
        socket.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
        await Promise.race([new Promise((r) => { socket.onopen = r; }), sleep(5000).then(() => { throw new Error('no bubble socket'); })]);
        bws = socket;
        bsend = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); socket.send(JSON.stringify({ id: i, method, params })); });
        await bsend('Runtime.enable');
        return;
      }
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('the bubble page never appeared');
};
const bev = async (expr) => { await bubbleConnect(); return (await bsend('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value; };
const bstate = async () => JSON.parse(await bev('JSON.stringify({ b: document.getElementById("bubble").dataset.badge, l: document.getElementById("badge").textContent, h: document.getElementById("badge").hidden, t: document.body.dataset.theme, label: document.getElementById("bubble").getAttribute("aria-label") })'));
const waitBadge = (badge, label, ms = 15000) => until(async () => { try { const b = await bstate(); return b.b === badge && (label === undefined || b.l === label); } catch { return false; } }, ms);
const bubbleShot = async (name, theme) => {
  await bubbleConnect();
  if (theme) await bev(`document.body.dataset.theme=${JSON.stringify(theme)}`);
  await bsend('Emulation.setDefaultBackgroundColorOverride', { color: { r: 120, g: 128, b: 150, a: 1 } });
  await sleep(200);
  const r = await bsend('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 56, height: 56, scale: 5 } });
  fs.writeFileSync(path.join(outDir, `bubble-${name}.png`), Buffer.from(r.result.data, 'base64'));
  await bsend('Emulation.setDefaultBackgroundColorOverride', {});
};
const bubbleOnlyOne = () => bubbleLog().every((l) => !(l.bubbleVisible && l.stripVisible));
const waitBubbleShown = (n, ms = 10000) => until(() => bubbleCount('show') >= n, ms);
// A hide through the button, then wait until the bubble is really up (the first one has to load its page).
const hideToBubble = async () => { const n = bubbleCount('show'); await hideViaButton(); return waitBubbleShown(n + 1); };
const clickBubble = async (dx = 0) => { const n = vlines().length; command(`bubble-click ${JSON.stringify({ dx })}`); return waitV(n + 1, 5000); };
// The real control on the Status tab (changes the local setting, so the strip's buttons follow).
const chooseMinimize = async (value) => {
  await setPanel(true);
  await clickTab('Status');
  await ev(`(()=>{const el=document.getElementById("minimize-to");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event("change",{bubbles:true}));})()`);
  await sleep(500);
  await setPanel(false);
};
const settingsBubble = () => evAsync('window.bar.getSettings().then(s=>JSON.stringify({m:s.minimizeTo,p:s.bubblePos}))').then(JSON.parse);

try {
  app = launch({});
  await connect();
  await sleep(1500);
  await ev('globalThis.__cbhIdleMs = 3600000');
  await evAsync('window.bar.updateSettings({ notifyDone: true, notifyFail: true }).then(()=>true)');

  // ----- 1. the strip button, then hide with the panel AND the drawer open -----
  const btn = await ev('(()=>{const b=document.getElementById("hide-app");return b?JSON.stringify({t:b.title,a:b.getAttribute("aria-label"),tag:b.tagName}):null})()');
  check('1 the strip has a real hide button whose title and aria-label name the bubble', !!btn && /BUTTON/.test(btn) && /bubble/.test(JSON.parse(btn).t) && /bubble/.test(JSON.parse(btn).a), btn);
  await shot('window-1-strip-dark');
  await lightTheme(true);
  await shot('window-2-strip-light');
  await lightTheme(false);
  await setPanel(true);
  await clickTab('Status');
  await ev('document.getElementById("hide-app-settings").scrollIntoView({block:"center"})');
  await sleep(300);
  check('1 Status has a Hide button, the Minimize to setting (bubble by default) and says how to get back', await ev('!!document.getElementById("hide-app-settings") && /round button/.test(document.querySelector(".hide-app-row p")?.textContent||"") && document.getElementById("minimize-to")?.value==="bubble"'));
  await shot('window-3-status-dark');
  await lightTheme(true);
  await shot('window-4-status-light');
  await lightTheme(false);
  await clickTab('Expedition');
  await click('.archive-pill');
  await sleep(900);
  check('1 the panel and the drawer are open before hiding', (await panelOpen()) && (await drawerNow()));
  await click('#hide-app');
  check('1 hide: logged as button, hidden, panel and drawer closed in main', await waitV(1));
  const h1 = lastV();
  check('1 log: hide / button / changed, visible false, panelOpen false, drawerOpen false', h1.action === 'hide' && h1.reason === 'button' && h1.changed === true && h1.visible === false && h1.panelOpen === false && h1.drawerOpen === false && h1.ignore === true, JSON.stringify(h1));
  await sleep(500);
  check('1 the page follows: body.app-hidden, panel closed, drawer classes gone', (await hiddenNow()) && !(await panelOpen()) && !(await drawerNow()));
  check('1 bubble: it appears (strip hidden, bubble shown, never both) and the effects are ordered', await waitBubbleShown(1) && bubbleLast('show').stripVisible === false && bubbleLast('show').bubbleVisible === true && h1.effects.join() === 'stop-drag,close-panel,hide-window,show-bubble,notify-renderer', JSON.stringify(h1.effects));
  check('10 the battle loop is paused while hidden', (await ev('document.getElementById("stage").dataset.loop')) === 'paused');

  // ----- 2. idempotence -----
  const before2 = vlines().length;
  await evAsync('window.bar.hideWindow().then(()=>true)');
  await waitV(before2 + 1);
  check('2 a second hide is a no-op (changed false, still hidden)', lastV().changed === false && lastV().visible === false);
  await showViaTray();
  check('2 tray: shows (changed, visible, reason tray)', lastV().changed === true && lastV().visible === true && lastV().reason === 'tray' && lastV().action === 'show', JSON.stringify(lastV()));
  check('2 tray: the chat opens with the strip', await until(panelOpen, 4000));
  check('2 the tray show took the bubble down first: the bubble is hidden and was never shown together with the strip', bubbleLast('hide')?.bubbleVisible === false && bubbleLast('hide')?.stripVisible === false && bubbleOnlyOne());
  command('tray');
  await waitV(before2 + 3);
  check('2 tray again: hides', lastV().visible === false && lastV().action === 'hide');
  command('tray');
  await waitV(before2 + 4);
  check('2 and once more: visible, no duplicate effects', lastV().visible === true && vlines().length === before2 + 4);
  await sleep(500);
  check('10 the loop runs again after a show', (await ev('document.getElementById("stage").dataset.loop')) === 'running' && (await evAsync('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(true))))')) === true);
  check('7 a valid saved position is kept exactly', JSON.stringify(lastV().pos) === JSON.stringify({ x: 100, y: 400 }), JSON.stringify(lastV().pos));

  // ----- 3. a run is not stopped by hiding (success and failure) -----
  await idle();
  fs.rmSync(logFile, { force: true });
  await sendText('NOTIFYLONG hidden');
  await until(async () => !(await asleep()));
  await sleep(500);
  await hideViaButton();
  check('3 hidden while the run works', lastV().visible === false);
  check('3 the run finishes cleanly (not cancelled)', await until(async () => (await logText()).includes('long done'), 12000));
  check('3 exactly one native notification, kind done', await waitNotes(1, 8000) && (await sleep(1500), notes().length === 1) && notes()[0].kind === 'done', JSON.stringify(notes()));
  check('3 no Stop / stopped line in the chat', !/stop/i.test(await logText()));
  await idle();
  await sendText('NOTIFYFAIL hidden');
  check('3 a failure while hidden also produces its notification', await waitNotes(2, 10000) && notes()[1].kind === 'failed', JSON.stringify(notes()));
  await idle();

  // ----- 4. an agent and a queued message while hidden -----
  fs.rmSync(logFile, { force: true });
  await sendText('/alpha NOTIFYLONG agent');
  await until(async () => !(await asleep()));
  await sleep(400);
  check('4 agent: the run completes while the window is hidden', await until(async () => ((await logText()).match(/is working in its own tab/g) || []).length >= 1 && (await tabCount('alpha')) >= 1, 8000) && await waitNotes(1, 15000) && /alpha finished/.test(notes()[0].title), JSON.stringify(notes()));
  await idle();
  const quickCount = async () => ((await logText()).match(/quick done/g) || []).length;
  const q0 = await quickCount();
  await sendText('NOTIFYQUICK q1');
  await until(async () => !(await asleep()));
  await queueText('NOTIFYQUICK q2');
  check('4 queue: both messages complete while hidden', await until(async () => (await quickCount()) >= q0 + 2, 25000), `${await quickCount()} vs ${q0}`);
  await idle();

  // ----- 11. click-through after a show (renderer and main agree again) -----
  await showViaTray();
  await sleep(600);
  const p = await center('#toggle-panel');
  // The CDP mouse events carry no real cursor: main's click-through watchdog (150 ms) reads the OS cursor, so it is
  // told, through the command seam, that the cursor sits over the strip (the strip is at 100,400 and 560 x 96).
  command('cursor {"x":380,"y":448}');
  await sleep(500);
  await mouse('mouseMoved', { x: 5, y: 5 }); // outside the strip first
  await mouse('mouseMoved', p);
  await sleep(300);
  const cts = () => winLines().filter((l) => l.event === 'click-through');
  check('11 moving over the strip tells main to accept the mouse', cts().at(-1)?.ignore === false, JSON.stringify(cts().at(-1)));
  await hideViaButton();
  check('11 hiding makes main click-through again', cts().at(-1)?.ignore === true);
  const nBefore = cts().length;
  await showViaTray();
  await sleep(500);
  await mouse('mouseMoved', { x: p.x + 1, y: p.y + 1 });
  await sleep(300);
  check('11 after the show the first move over the strip reaches main again (no stuck flag)', cts().length > nBefore && cts().at(-1).ignore === false, JSON.stringify(cts().slice(nBefore)));
  await mouse('mousePressed', p);
  await mouse('mouseReleased', p);
  await sleep(900);
  check('11 and a real click on the chat button reaches the page: the panel the tray show opened closes', await until(async () => !(await panelOpen()), 4000));
  await setPanel(false);

  // Watchdog: the window takes the mouse but the (fake) cursor is far outside the strip and the closed panel, so main
  // makes the window click-through by itself, and the page starts over so the next move over the strip works again.
  await mouse('mouseMoved', p);
  await sleep(400);
  const nw = cts().length;
  command('cursor {"x":380,"y":150}'); // inside the big transparent window, over nothing
  await sleep(900);
  check('11 watchdog: a cursor outside every interactive rectangle makes the window click-through again', cts().length > nw && cts().at(-1).ignore === true, JSON.stringify(cts().slice(nw)));
  command('cursor {"x":380,"y":448}');
  await sleep(500);
  const nw2 = cts().length;
  await mouse('mouseMoved', { x: p.x + 2, y: p.y });
  await sleep(300);
  check('11 watchdog: the first move back over the strip accepts the mouse again (page reset)', cts().length > nw2 && cts().at(-1).ignore === false, JSON.stringify(cts().slice(nw2)));
  await sleep(700);
  check('11 watchdog: a cursor over the strip does not flap', cts().slice(nw2).length === 1, JSON.stringify(cts().slice(nw2)));
  command('cursor off');

  // ----- race: the chat button and hide in the same tick -----
  const nr = vlines().length;
  await ev('document.getElementById("toggle-panel").click(); window.bar.hideWindow();');
  await waitV(nr + 1);
  await sleep(1200);
  check('race: chat click and hide in the same tick leave main and the page closed', lastV().visible === false && lastV().panelOpen === false && !(await panelOpen()), JSON.stringify(lastV()));
  await showViaTray();
  await sleep(600);
  check('race: after the tray show the chat opens, and the window is not stuck in the closed state', await until(panelOpen, 4000));
  await setPanel(false);

  // ----- 6. every way back; shortcut, notification click, tray and bubble open the panel, a second launch does not -----
  await hideViaButton();
  command('shortcut');
  await waitV(vlines().length + 1);
  await sleep(1000);
  check('6 shortcut: shows (reason shortcut) and opens the panel', lastV().reason === 'shortcut' && lastV().visible === true && (await panelOpen()), JSON.stringify(lastV()));
  check('6 shortcut: the bubble is gone', bubbleLast('hide')?.bubbleVisible === false && bubbleOnlyOne());
  await setPanel(false);
  await hideViaButton();
  command('notify-click {"wsId":"notify-ws","agentId":null}');
  await waitV(vlines().length + 1);
  await sleep(1000);
  check('6 notification click: shows (reason notification), opens the panel on Expedition', lastV().reason === 'notification' && lastV().visible === true && (await panelOpen()) && await ev('!document.getElementById("tab-project-chat").classList.contains("hidden")'), JSON.stringify(lastV()));
  check('6 notification click: the bubble is gone', bubbleLast('hide')?.bubbleVisible === false && bubbleOnlyOne());
  await setPanel(false);
  await hideViaButton();
  const n6 = vlines().length;
  const second = spawn(electronBin, [root, `--user-data-dir=${userData}`], { env: { ...process.env, CLAUDE_BIN: fake }, stdio: 'ignore' });
  const exited = await Promise.race([new Promise((r) => second.on('exit', (c) => r(c))), sleep(20000).then(() => 'timeout')]);
  if (exited === 'timeout') second.kill();
  check('6 a second launch with the same user-data folder quits by itself', exited !== 'timeout', `exit ${exited}`);
  await waitV(n6 + 1);
  check('6 ...and brings the running app back (reason second-instance), panel left closed', lastV().reason === 'second-instance' && lastV().visible === true && !(await panelOpen()), JSON.stringify(lastV()));
  check('6 second launch: the bubble is gone too', bubbleLast('hide')?.bubbleVisible === false && bubbleOnlyOne());
  check('6 the running app is still the same one (settings intact, no page errors)', pageErrors.length === 0 && (await evAsync('window.bar.getSettings().then(s=>s.workspaces.length===1)')) === true, pageErrors.join(' | '));

  // a launch with ANOTHER user-data folder is independent (the lock is per folder)
  const otherData = fs.mkdtempSync(path.join(work, 'other-'));
  const otherPort = port + 50;
  const other = spawn(electronBin, [root, `--user-data-dir=${otherData}`, `--remote-debugging-port=${otherPort}`], { env: { ...process.env, CLAUDE_BIN: fake, CBH_NOTIFY_OFF: '1' }, stdio: 'ignore' });
  let otherExit = null;
  other.on('exit', (c) => { otherExit = c; });
  let otherUp = false;
  for (let i = 0; i < 20 && !otherUp && otherExit === null; i++) {
    try { otherUp = (await fetch(`http://localhost:${otherPort}/json`)).ok; } catch { await sleep(500); }
  }
  await sleep(1500);
  check('6 an app with its own user-data folder starts and stays (the lock is per folder)', otherUp && otherExit === null, `up ${otherUp} exit ${otherExit}`);
  other.kill();
  await sleep(500);
  check('6 the first app did not react to it', lastV().reason === 'second-instance');

  // ----- 8. hostile input changes nothing; hidden is never persisted -----
  await evAsync('window.bar.setSettings({ hidden: true, startHidden: true, visible: false }).then(()=>true)');
  await evAsync('window.bar.updateSettings({ hidden: true, startHidden: true, visible: false }).then(()=>true)');
  const keys = await evAsync('window.bar.getSettings().then(s=>Object.keys(s).filter(k=>/hid|visib/i.test(k)).join(","))');
  check('8 settings:set and settings:update cannot set window state', keys === '' && lastV().visible === true, keys);
  check('8 the window did not change', vlines().at(-1).reason === 'second-instance');

  // ----- 5. a permission request while hidden: a native "needs your OK", no auto-show, no auto-approve -----
  await restart({ CLAUDE_BIN: fakePerm }, { rewrite: () => cleanFiles() });
  await ev('globalThis.__cbhIdleMs = 3600000');
  await evAsync('window.bar.updateSettings({ permissionMode: "default" }).then(()=>true)');
  await sendText('PERMSTALL hidden');
  check('5 the card is pending (strip pulses)', await until(() => ev('document.body.classList.contains("perm-pending")'), 10000));
  await hideViaButton();
  check('5 one native "needs your OK" line, fixed text, no tool text', await waitNotes(1, 8000) && (await sleep(1500), notes().length === 1) && notes()[0].kind === 'permission' && notes()[0].title === 'notifysim needs your OK' && notes()[0].body === 'Open Claudebar Heroes to allow or deny.' && !/Bash|sleep|1000/.test(JSON.stringify(notes()[0])), JSON.stringify(notes()));
  check('5 bubble: opens already amber with the count of waiting requests (ask, 1)', await waitBadge('ask', '1', 8000), JSON.stringify(await bstate()));
  await bubbleShot('ask-dark', 'dark');
  await bubbleShot('ask-light', 'light');
  await sleep(2000);
  check('5 no auto-show and no auto-approve: still hidden, the request still pending', lastV().visible === false && (await ev('document.body.classList.contains("perm-pending")')) && !(await ev('document.querySelector("#tab-project-chat .msg-log")?.innerText.includes("stall answered")')));
  command('notify-click {"wsId":"notify-ws","agentId":null}');
  await waitV(vlines().length + 1);
  await sleep(1200);
  check('5 the click shows the window, opens the panel and the card', lastV().visible === true && (await panelOpen()) && await ev('!!document.querySelector(".perm-card")'), JSON.stringify(lastV()));
  check('5 the click showed the strip and took the bubble down', bubbleLast('hide')?.bubbleVisible === false && bubbleOnlyOne());
  await click('.perm-allow');
  check('5 the card can be answered (Allow once): the run goes on', await until(async () => (await logText()).includes('stall answered'), 10000));
  await idle();
  // a request raised while the window is already hidden
  await setPanel(false);
  await hideViaButton();
  const n5a = notes().length;
  await sendText('PERMSTALL arrives');
  check('5 bubble: a request raised while hidden turns it amber', await waitBadge('ask', '1', 8000), JSON.stringify(await bstate()));
  check('5 a request raised while hidden gets its notification too', await waitNotes(n5a + 1, 10000) && notes().at(-1).kind === 'permission' && notes().at(-1).target?.wsId === 'notify-ws', JSON.stringify(notes().at(-1)));
  command('notify-click {"wsId":"notify-ws","agentId":null}');
  await until(() => ev('!!document.querySelector(".perm-allow")'), 8000);
  await click('.perm-allow');
  await idle();
  // both notification switches off: no line
  await evAsync('window.bar.updateSettings({ notifyDone: false, notifyFail: false }).then(()=>true)');
  const n5 = notes().length;
  await setPanel(false);
  await sendText('PERMSTALL quiet');
  await until(() => ev('document.body.classList.contains("perm-pending")'), 10000);
  await hideViaButton();
  await sleep(2500);
  check('5 both notification switches off: no permission notification', notes().length === n5, `${notes().length} vs ${n5}`);
  check('5 ...but the bubble still shows the blocked run (ask)', await waitBadge('ask', '1', 5000), JSON.stringify(await bstate()));
  await showViaTray();
  await setPanel(true);
  await until(() => ev('!!document.querySelector(".perm-deny")'), 5000);
  await click('.perm-deny');
  await idle();
  await setPanel(false);
  await evAsync('window.bar.updateSettings({ notifyDone: true, notifyFail: true }).then(()=>true)');

  // ----- 7/8. an off-screen saved position; the app starts visible after a restart (hide first) -----
  await restart({ CLAUDE_BIN: fake }, { rewrite: () => {
    const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    s.windowPos = { x: 99999, y: 99999 };
    fs.writeFileSync(settingsFile, JSON.stringify(s));
    cleanFiles();
  } });
  await hideViaButton();
  await showViaTray();
  const pos = lastV().pos;
  check('7 an off-screen saved position comes back on a display (default spot)', pos && pos.x > -5000 && pos.x < 20000 && pos.y > -5000 && pos.y < 20000 && pos.x !== 99999, JSON.stringify(pos));

  await sendText('NOTIFYQUICK persist');
  await until(async () => (await logText()).includes('quick done'), 8000);
  await idle();
  await hideViaButton();
  // The app restarts itself while hidden (main releases the single-instance lock first, or the new process would quit at once).
  relaunching = true;
  cleanFiles(); // the relaunched app would replay an old command file from its first line
  await ev('window.bar.restartApp()');
  stopping.add(ws); try { ws.close(); } catch { /* closed */ } ws = undefined;
  await sleep(5000);
  await connect();
  relaunching = false;
  await sleep(1500);
  check('8 after a restart the app is visible again (the page is not in the hidden state)', !(await hiddenNow()));
  const n8 = vlines().length;
  command('tray');
  await waitV(n8 + 1);
  check('8 main started visible: the first tray toggle hides it', lastV().action === 'hide' && lastV().visible === false, JSON.stringify(lastV()));
  await showViaTray();
  const onDisk = fs.readFileSync(settingsFile, 'utf8');
  check('8 settings.json has no window state key', !/"(hidden|startHidden|visible|canHide)"/i.test(onDisk));
  check('8 the chat written while the app was hidden survived the restart', (await logText()).includes('quick done'));
  await shot('window-5-after-restart');

  // ----- 12. the floating bubble -----
  await ev('globalThis.__cbhIdleMs = 3600000');
  await evAsync('window.bar.updateSettings({ notifyDone: true, notifyFail: true, permissionMode: "default", minimizeTo: "bubble", theme: "dark" }).then(()=>true)');
  await idle();
  check('12 the setting defaults to the bubble', (await settingsBubble()).m === 'bubble');
  check('12 windowInfo: canHide, bubble mode, tray and bubble both available', (await evAsync('window.bar.windowInfo().then(i=>JSON.stringify(i))')) === '{"canHide":true,"minimizeTo":"bubble","tray":true,"bubble":true}');
  check('12 the app window has no bubble bridge', (await ev('typeof window.bubble')) === 'undefined');
  fs.rmSync(logFile, { force: true });

  // 12a. the bubble page: no app bridge, only four functions, fixed label, navigation blocked, nothing but a badge
  const stripBefore = JSON.stringify(lastV().pos);
  await hideToBubble();
  check('12a the bubble page has NO window.bar and no node', (await bev('typeof window.bar')) === 'undefined' && (await bev('typeof require + typeof process')) === 'undefinedundefined');
  check('12a window.bubble has exactly press, release, menu, onState', (await bev('Object.keys(window.bubble).sort().join()')) === 'menu,onState,press,release');
  const st0 = await bstate();
  check('12a the page is a labelled image, no badge when nothing happens', st0.b === 'none' && st0.h === true && st0.label === 'Open Claudebar Heroes' && (await bev('document.getElementById("bubble").getAttribute("role")')) === 'img' && (await bev('document.getElementById("bubble").title')) === 'Open Claudebar Heroes', JSON.stringify(st0));
  await bev('location.assign("data:text/html,hijacked"); 1');
  await sleep(700);
  check('12a navigation away is blocked, and so is a new window', /bubble\.html$/.test(await bev('location.href')) && (await bev('window.open("about:blank") === null')) === true);
  await bubbleShot('none-dark', 'dark');
  await bubbleShot('none-light', 'light');
  check('12a the main page and the bubble are never on screen together so far', bubbleOnlyOne());

  // 12b. click restores (reason bubble), a double click is one change, a click-sized press (<= 5 px) is a click
  const vBefore = vlines().length;
  command('bubble-click {"dx":3}');
  command('bubble-click {"dx":0}');
  await waitV(vBefore + 1, 5000);
  await sleep(800);
  check('12b a click (3 px of movement) shows the strip with reason bubble, and the second click is ignored', vlines().length === vBefore + 1 && lastV().reason === 'bubble' && lastV().action === 'show' && lastV().visible === true, JSON.stringify(lastV()));
  check('12b the click also opens the chat (the panel), not just the strip', await until(panelOpen, 4000));
  check('12b the bubble went down BEFORE the strip appeared', lastV().effects.join() === 'place,hide-bubble,show-window,reassert,notify-renderer' && bubbleLast('hide').stripVisible === false && bubbleLast('hide').bubbleVisible === false && bubbleOnlyOne());
  check('12b the strip comes back at its own place, not the bubble\'s', JSON.stringify(lastV().pos) === stripBefore, `${JSON.stringify(lastV().pos)} vs ${stripBefore}`);

  // 12c. drag: more than 5 px is a drag and never a click; saved by main, clamped, remembered
  await hideToBubble();
  const pos0 = bubbleLast('show').bpos;
  const nV = vlines().length;
  const nM = bubbleCount('move');
  command('bubble-drag {"dx":-40,"dy":-30}');
  check('12c a 40 px drag (left and up) moves the bubble and saves the spot', await until(() => bubbleCount('move') > nM, 5000) && bubbleLast('move').bpos.x === pos0.x - 40 && bubbleLast('move').bpos.y === pos0.y - 30, JSON.stringify([pos0, bubbleLast('move')?.bpos]));
  const nM2 = bubbleCount('move');
  command('bubble-click {"dx":6}');
  await until(() => bubbleCount('move') > nM2, 5000);
  check('12c a 6 px press is a drag too: the strip stays hidden', vlines().length === nV && lastV().visible === false);
  const saved = await settingsBubble();
  check('12c bubblePos is in the settings main holds', JSON.stringify(saved.p) === JSON.stringify(bubbleLast('move').bpos), JSON.stringify(saved));
  const dragged = bubbleLast('move').bpos;
  await clickBubble(0);
  await hideToBubble();
  check('12c the bubble comes back where it was dropped', JSON.stringify(bubbleLast('show').bpos) === JSON.stringify(dragged), JSON.stringify([bubbleLast('show').bpos, dragged]));
  await clickBubble(0);

  // 12d. badges: running, done (latched, cleared on show), failed, and failed beats done
  await sendText('NOTIFYHOLD working');
  await until(async () => !(await asleep()));
  await hideToBubble();
  check('12d running: a ring and no number', await waitBadge('running', '', 8000) && (await bstate()).h === true, JSON.stringify(await bstate()));
  check('12d the ring turns by default and stands still under reduced motion', (await bev('getComputedStyle(document.getElementById("ring")).animationName')) !== 'none'
    && await (async () => { await bsend('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await sleep(200); const v = await bev('getComputedStyle(document.getElementById("ring")).animationName'); await bsend('Emulation.setEmulatedMedia', { features: [] }); return v === 'none'; })());
  await bubbleShot('running-dark', 'dark');
  await bubbleShot('running-light', 'light');
  await clickBubble(0);
  const nSt = notes().length;
  await click('#tab-project-chat .stop');
  await idle();
  await hideToBubble();
  check('12d Stop is silent: no badge, no notification', await waitBadge('none', '', 5000) && notes().length === nSt, JSON.stringify(await bstate()));
  await clickBubble(0);

  await sendText('NOTIFYLONG finish');
  await until(async () => !(await asleep()));
  await hideToBubble();
  check('12d done: a green badge with the count 1 once the notification fired', await waitBadge('done', '1', 20000), JSON.stringify(await bstate()));
  check('12d the aria-label says what it means', /finished/.test((await bstate()).label));
  await bubbleShot('done-dark', 'dark');
  await bubbleShot('done-light', 'light');
  await clickBubble(0);
  await hideToBubble();
  check('12d the finished mark is gone after the strip was shown, and a later hide does not bring it back', await waitBadge('none', '', 5000), JSON.stringify(await bstate()));
  await clickBubble(0);

  await hideToBubble();
  await sendText('NOTIFYFAIL boom');
  check('12d failed: a red badge with the count 1', await waitBadge('failed', '1', 12000), JSON.stringify(await bstate()));
  await bubbleShot('failed-dark', 'dark');
  await bubbleShot('failed-light', 'light');
  await idle();
  await sendText('NOTIFYLONG after');
  check('12d a later success does not hide the failure (failed > done)', await until(async () => (await logText()).includes('long done'), 15000) && (await sleep(2500), (await bstate()).b === 'failed' && (await bstate()).l === '1'), JSON.stringify(await bstate()));
  await clickBubble(0);
  await idle();

  // 12e. the right-click menu: fixed items, Show brings the strip back
  await hideToBubble();
  command('bubble-menu');
  await until(() => bubbleCount('menu') >= 1, 5000);
  check('12e the menu has exactly Show Claudebar Heroes, a separator and Quit', JSON.stringify(bubbleLast('menu')?.labels) === '["Show Claudebar Heroes","-","Quit"]', JSON.stringify(bubbleLast('menu')));
  const nVm = vlines().length;
  command('bubble-menu Show Claudebar Heroes');
  await waitV(nVm + 1, 5000);
  check('12e "Show" in the menu shows the strip (reason bubble)', lastV().reason === 'bubble' && lastV().visible === true);

  // 12f. hostile settings: nothing can set the bubble's spot or an unknown mode
  const keep = await settingsBubble();
  await evAsync('window.bar.updateSettings({ minimizeTo: "x", bubblePos: { x: 5, y: 5 } }).then(()=>true)');
  await evAsync('window.bar.setSettings({ minimizeTo: "tray", bubblePos: { x: 1, y: 1 } }).then(()=>true)');
  const after = await settingsBubble();
  check('12f settings:update rejects an unknown minimizeTo and any bubblePos, settings:set drops both', JSON.stringify(after) === JSON.stringify(keep), JSON.stringify([keep, after]));
  check('12f the page cannot reach the bubble channels (the app bridge has none)', (await ev('Object.keys(window.bar).filter(k=>/bubble/i.test(k)).length')) === 0);

  // 12g. "Tray only": no bubble at all; the tray and the shortcut still bring the app back
  await chooseMinimize('tray');
  await sleep(300);
  const shows12 = bubbleCount('show');
  check('12g the Status setting follows (windowInfo says tray)', (await evAsync('window.bar.windowInfo().then(i=>i.minimizeTo+i.canHide)')) === 'traytrue');
  await hideViaButton();
  await sleep(1200);
  check('12g tray mode: the app hides without a bubble', lastV().visible === false && bubbleCount('show') === shows12 && lastV().effects.join() === 'stop-drag,close-panel,hide-window,notify-renderer', JSON.stringify(lastV().effects));
  await showViaTray();
  await hideViaButton();
  command('shortcut');
  await waitV(vlines().length + 1);
  check('12g tray mode: the tray and the shortcut still restore', lastV().reason === 'shortcut' && lastV().visible === true);
  await setPanel(false);
  await chooseMinimize('bubble');
  check('12g the select saved the choice in main', (await settingsBubble()).m === 'bubble');

  // 12h. a dropped spot that no display shows any more is replaced by the default one
  await restart({ CLAUDE_BIN: fake }, { rewrite: () => {
    const f = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    f.bubblePos = { x: 99999, y: -99999 };
    f.theme = 'light';
    fs.writeFileSync(settingsFile, JSON.stringify(f));
    cleanFiles();
  } });
  await hideToBubble();
  const far = bubbleLast('show').bpos;
  check('12h an off-screen bubblePos in settings.json is replaced by a spot on a display', far.x > -5000 && far.x < 20000 && far.y > -5000 && far.y < 20000 && far.x !== 99999, JSON.stringify(far));
  check('12h the bubble takes the theme from settings (light)', (await bstate()).t === 'light');
  await bubbleShot('none-light-real', undefined);
  await restart({ CLAUDE_BIN: fake }, { rewrite: () => {
    const f = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    f.bubblePos = 'junk';
    f.minimizeTo = 'nonsense';
    f.theme = 'dark';
    fs.writeFileSync(settingsFile, JSON.stringify(f));
    cleanFiles();
  } });
  check('12h junk minimizeTo / bubblePos in settings.json load as the defaults', JSON.stringify(await settingsBubble()) === '{"m":"bubble","p":null}', JSON.stringify(await settingsBubble()));

  // 12i. the bubble cannot be made: the old tray rule applies
  await restart({ CLAUDE_BIN: fake, CBH_WINDOW_NOBUBBLE: '1' }, { rewrite: () => cleanFiles() });
  check('12i NOBUBBLE: windowInfo says no bubble, hiding still possible through the tray', (await evAsync('window.bar.windowInfo().then(i=>JSON.stringify(i))')) === '{"canHide":true,"minimizeTo":"bubble","tray":true,"bubble":false}');
  await hideViaButton();
  await sleep(800);
  check('12i NOBUBBLE: it hides without a bubble (tray is the way back)', lastV().visible === false && bubbleCount('show') === 0 && lastV().effects.join() === 'stop-drag,close-panel,hide-window,notify-renderer');
  await showViaTray();
  await restart({ CLAUDE_BIN: fake, CBH_WINDOW_NOBUBBLE: '1', CBH_WINDOW_NOTRAY: '1' }, { rewrite: () => cleanFiles() });
  check('12i neither a tray nor a bubble: windowInfo says canHide false and no buttons', (await evAsync('window.bar.windowInfo().then(i=>i.canHide)')) === false);
  check('12i ...and hide is refused', (await evAsync('window.bar.hideWindow().then(r=>JSON.stringify(r))')) === '{"ok":false,"reason":"no-tray"}');

  // ----- 9. no tray: the bubble is the way back; in "Tray only" mode there is no way back, so no way to hide -----
  await restart({ CLAUDE_BIN: fake, CBH_WINDOW_NOTRAY: '1' }, { rewrite: () => cleanFiles() });
  check('9 no tray, bubble mode: windowInfo says canHide true (the bubble is the way back)', (await evAsync('window.bar.windowInfo().then(i=>JSON.stringify(i))')) === '{"canHide":true,"minimizeTo":"bubble","tray":false,"bubble":true}');
  await setPanel(true);
  await clickTab('Status');
  check('9 the hide buttons are there, "Tray only" is disabled in the setting', await ev('!!document.getElementById("hide-app") && !!document.getElementById("hide-app-settings") && document.querySelector("#minimize-to option[value=tray]").disabled'));
  await setPanel(false);
  await hideToBubble();
  check('9 it hides to the bubble without a tray', lastV().visible === false && bubbleLast('show').bubbleVisible === true);
  check('9 the bubble is the only handle (still hidden)', lastV().visible === false);
  await clickBubble(0);
  check('9 the bubble click restored it', lastV().visible === true && lastV().reason === 'bubble');
  await chooseMinimize('tray');
  check('9 tray mode without a tray: windowInfo says canHide false', (await evAsync('window.bar.windowInfo().then(i=>i.canHide)')) === false);
  await setPanel(true);
  await clickTab('Status');
  check('9 neither hide button is rendered', await ev('!document.getElementById("hide-app") && !document.getElementById("hide-app-settings")'));
  await shot('window-6-status-no-tray');
  await setPanel(false);
  const nv9 = vlines().length;
  const r9 = await evAsync('window.bar.hideWindow().then(r=>JSON.stringify(r))');
  await waitV(nv9 + 1);
  check('9 window:hide is refused and logged, the window stays visible', r9 === '{"ok":false,"reason":"no-tray"}' && lastV().refused === 'no-tray' && lastV().visible === true && lastV().canHide === false, `${r9} ${JSON.stringify(lastV())}`);
  command('tray');
  await sleep(600);
  check('9 a tray command cannot hide it either', !(await hiddenNow()));
  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  console.log(`FAIL  simulation error: ${err.message}`);
  results.push(false);
} finally {
  relaunching = true;
  stopApp();
  await killOwn();
  fs.rmSync(work, { recursive: true, force: true });
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${outDir}`);
process.exit(failed ? 1 : 0);
