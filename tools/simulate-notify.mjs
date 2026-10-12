// Focused simulation of the notifications ("work finished" / "something failed"): the real app in an isolated user-data
// folder against tools/fake-notify.mjs, driven over the Chrome DevTools protocol. Native notifications are replaced by the
// log seam CBH_NOTIFY_LOG (one JSON line per notification that WOULD be shown), so nothing pops up while this runs.
// Covers: long/short success, failure wording, Stop is silent, chains, the queue, the two settings flags (and that
// only real booleans are accepted), the in-app cue (bubble / toast), the Test button, the spam limit and screenshots.
//
// Usage: npm run simulate:notify [-- --out <screenshot-dir>]   (builds first). Exit code 1 if a check fails.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = createRequire(import.meta.url)('electron');
const outFlag = process.argv.indexOf('--out');
const outDir = outFlag > -1 ? path.resolve(process.argv[outFlag + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-notify-shots-'));
fs.mkdirSync(outDir, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-notifysim-'));
let port = 9500 + Math.floor(Math.random() * 90);

const fake = path.join(work, 'fake-claude.sh');
fs.writeFileSync(fake, `#!/bin/bash\nexec "$FAKE_NODE" "${path.join(root, 'tools', 'fake-notify.mjs')}" "$@"\n`, { mode: 0o755 });
const logFile = path.join(work, 'notify.log');
const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

const project = path.join(work, 'project');
fs.mkdirSync(path.join(project, '.claude', 'agents'), { recursive: true });
for (const n of ['alpha', 'beta']) fs.writeFileSync(path.join(project, '.claude', 'agents', `${n}.md`), `---\nname: ${n}\ndescription: Simulated ${n} agent\n---\n\nYou are ${n}.\n`);
const userData = path.join(work, 'userData');
fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  permissionMode: 'default', windowPos: null, theme: 'dark', panelHeight: 500, activeId: 'notify-ws',
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
const stopping = new WeakSet();
let app; let ws; let send;
const launch = (env = {}) => {
  const child = spawn(electronBin, [root, `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
    env: { ...process.env, CLAUDE_BIN: fake, FAKE_NODE: process.execPath, CBH_NOTIFY_LOG: logFile, CBH_NOTIFY_MIN_MS: '2000', CBH_NOTIFY_QUIET_MS: '300', CBH_NOTIFY_MAX_PER_MIN: '100', CBH_NOTIFY_DEDUPE_MS: '0', CBH_NOTIFY_FOCUS: '0', ...env }, stdio: 'ignore',
  });
  child.on('exit', (code, signal) => { if (!stopping.has(child)) loseConnection(`the app exited by itself (code ${code}, signal ${signal})`); });
  child.on('error', (e) => loseConnection(`the app could not start: ${e.message}`));
  return child;
};
const stopApp = () => {
  if (ws) { stopping.add(ws); try { ws.close(); } catch { /* already closed */ } ws = undefined; }
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
      const page = list.find((p) => p.type === 'page');
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

const restart = async (env) => {
  stopApp();
  await sleep(1200);
  port += 1;
  app = launch(env);
  await connect();
  await sleep(1500);
};

try {
  app = launch({});
  await connect();
  await sleep(1500);
  await ev('globalThis.__cbhIdleMs = 3600000');

  // ----- 1. a long success (panel closed): one notification, the bubble says it too -----
  await sendText('NOTIFYLONG one');
  check('1 long run: exactly one notification', await waitNotes(1));
  await sleep(1500);
  const n1 = notes();
  check('1 long run: kind done, names the project and a duration, still just one', n1.length === 1 && n1[0].kind === 'done' && /^notifysim finished \(\d+s\)$/.test(n1[0].title), JSON.stringify(n1[0]));
  check('1 long run: the hero bubble shows the same words', /notifysim finished/.test(await bubbleText()), await bubbleText());
  await shot('notify-1-bubble-dark');
  await lightTheme(true);
  await shot('notify-2-bubble-light');
  await lightTheme(false);

  // ----- 2. a short lone success is silent -----
  await idle();
  await sendText('NOTIFYQUICK solo');
  await sleep(1500);
  check('2 quick run: the run really took place', await until(async () => (await logText()).includes('quick done'), 8000));
  await idle();
  await sleep(2000);
  check('2 quick run: no notification (below the minimum)', notes().length === 1);

  // ----- 3. a failure notifies at any length, with a fixed phrase and no path or key -----
  await sendText('NOTIFYFAIL now');
  check('3 failure: a notification after a run of under a second', await waitNotes(2, 10000));
  const f = notes()[1] ?? {};
  check('3 failure: kind failed, label and a fixed phrase', f.kind === 'failed' && /^notifysim failed/.test(f.title) && /^Claude exited with code 1\./.test(f.body), JSON.stringify(f));
  check('3 failure: no path, secret or raw stderr in any text', !/\/Users|SECRET|sk-ant|boom/.test(JSON.stringify(f)), JSON.stringify(f));
  check('3 failure: the bubble is prefixed with a warning sign', (await bubbleText()).startsWith('⚠'), await bubbleText());
  await idle();

  // ----- 4. Stop is silent -----
  const before4 = notes().length;
  await sendText('NOTIFYHOLD wait');
  check('4 Stop: the run is working', await until(async () => !(await asleep())) && await ev('!!document.querySelector("#tab-project-chat .stop")'));
  await sleep(2500);
  await click('#tab-project-chat .stop');
  check('4 Stop: the hero sleeps again', await idle());
  await sleep(2500);
  check('4 Stop: no notification', notes().length === before4);

  // ----- 5. a chain is ONE notification; a failing step ends it with one failure -----
  const before5 = notes().length;
  await sendText('/alpha NOTIFYQUICK && /beta NOTIFYQUICK');
  check('5 chain: one notification for both steps', await waitNotes(before5 + 1, 20000));
  await sleep(2500);
  const c = notes().slice(before5);
  check('5 chain: it says "2 tasks finished" and names both, nothing else follows', c.length === 1 && c[0].title === '2 tasks finished' && /alpha/.test(c[0].body) && /beta/.test(c[0].body), JSON.stringify(c));
  await idle();
  const betaTabs = await tabCount('beta');
  const before5b = notes().length;
  await sendText('/alpha NOTIFYFAIL && /beta NOTIFYQUICK');
  check('5 chain failure: one failed notification naming the agent', await waitNotes(before5b + 1, 15000));
  await sleep(2500);
  const cf = notes().slice(before5b);
  check('5 chain failure: exactly one, failed, and the second step never started', cf.length === 1 && cf[0].kind === 'failed' && /^alpha( 2)? failed/.test(cf[0].title) && (await tabCount('beta')) === betaTabs, JSON.stringify(cf));
  await idle();

  // ----- 6. the message queue: three runs, one notification -----
  const before6 = notes().length;
  await sendText('NOTIFYQUICK q1');
  await until(async () => !(await asleep()));
  await queueText('NOTIFYQUICK q2');
  await sleep(300);
  await queueText('NOTIFYQUICK q3');
  check('6 queue: one notification for the whole queue', await waitNotes(before6 + 1, 30000));
  await sleep(2500);
  const q = notes().slice(before6);
  check('6 queue: "3 tasks finished", once', q.length === 1 && q[0].title === '3 tasks finished', JSON.stringify(q));
  await idle();

  // ----- 7. the two switches silence their kind (and the cue) -----
  const before7 = notes().length;
  await evAsync('window.bar.updateSettings({ notifyDone: false }).then(()=>true)');
  await sendText('NOTIFYLONG off');
  await until(async () => (await logText()).includes('long done'), 12000);
  await idle();
  await sleep(2000);
  check('7 notifyDone off: no success notification', notes().length === before7);
  await evAsync('window.bar.updateSettings({ notifyDone: true, notifyFail: false }).then(()=>true)');
  await sendText('NOTIFYFAIL off');
  await sleep(1000);
  await idle();
  await sleep(2000);
  check('7 notifyFail off: no failure notification', notes().length === before7);
  await evAsync('window.bar.updateSettings({ notifyFail: true }).then(()=>true)');
  check('7 both flags are back on', (await settingsNow()) === '{"d":true,"f":true}', await settingsNow());

  // ----- 8. only real booleans are accepted, and settings:set cannot change them -----
  await evAsync('window.bar.updateSettings({ notifyDone: "no", notifyFail: 1 }).then(()=>true)');
  check('8 strings and numbers are ignored', (await settingsNow()) === '{"d":true,"f":true}', await settingsNow());
  await evAsync('window.bar.setSettings({ notifyDone: false, notifyFail: false }).then(()=>true)');
  check('8 settings:set cannot change them', (await settingsNow()) === '{"d":true,"f":true}', await settingsNow());
  await evAsync('window.bar.updateSettings({ notifyDone: null }).then(()=>true)');
  check('8 null is ignored too', (await settingsNow()) === '{"d":true,"f":true}');

  // ----- 9. in-app cue with the panel open -----
  await setPanel(true);
  await clickTab('Status');
  await sleep(300);
  const boxes = await ev('JSON.stringify({ d: document.getElementById("notify-done")?.checked, f: document.getElementById("notify-fail")?.checked, t: !!document.getElementById("notify-test") })');
  check('9 Status shows both checkboxes (on by default) and the Test button', boxes === '{"d":true,"f":true,"t":true}', boxes);
  await ev('document.getElementById("notify-done").scrollIntoView({block:"center"})');
  await sleep(200);
  await shot('notify-3-status-dark');
  await lightTheme(true);
  await shot('notify-4-status-light');
  await lightTheme(false);
  await ev('document.getElementById("notify-done").click()');
  await sleep(500);
  check('9 unticking a box persists through main', (await settingsNow()) === '{"d":false,"f":true}', await settingsNow());
  await ev('document.getElementById("notify-done").click()');
  await sleep(500);
  check('9 and ticking it again restores it', (await settingsNow()) === '{"d":true,"f":true}');

  const before9 = notes().length;
  await sendText('NOTIFYLONG cue');
  check('9 panel open on Status: a toast appears when the run ends', await waitCue(15000));
  const t1 = await cue();
  check('9 the toast is plain text from main, with Show and dismiss', /notifysim finished/.test(t1.text) && /good/.test(t1.cls) && (await ev('!!document.querySelector(".notify-show") && !!document.querySelector(".notify-x")')), JSON.stringify(t1));
  check('9 the toast does not take focus', await ev('!document.activeElement?.closest?.(".notify-cue")'));
  await sleep(400);
  await shot('notify-5-toast-dark');
  await lightTheme(true);
  await shot('notify-6-toast-light');
  await lightTheme(false);
  await click('.notify-show');
  await sleep(500);
  const shown = JSON.stringify({ cue: (await cue()).n, hidden: await ev('document.getElementById("tab-project-chat").className'), panel: await panelOpen() });
  check('9 Show goes to the Expedition tab and removes the toast', (await cue()).n === 0 && await ev('!document.getElementById("tab-project-chat").classList.contains("hidden")'), shown);
  await idle();
  await clickTab('Status');
  await sendText('NOTIFYFAIL cue');
  const gotFailCue = await waitCue(10000);
  check('9 a failure toast is styled as a failure', gotFailCue && /bad/.test((await cue()).cls), JSON.stringify(await cue()));
  await sleep(400);
  await shot('notify-7-toast-fail-dark');
  await lightTheme(true);
  await shot('notify-8-toast-fail-light');
  await lightTheme(false);
  await ev('document.querySelector(".notify-x").click()');
  check('9 the dismiss button closes it', (await cue()).n === 0);
  await idle();
  // Watching the very chat on screen: no toast and no notification (only when the window really has focus).
  await clickTab('Expedition');
  const before9w = notes().length;
  await sendText('NOTIFYLONG watch');
  await until(async () => (await logText()).includes('long done'), 12000);
  await idle();
  await sleep(1800);
  // Without real focus the chat on screen is not "watched": the toast shows and a native notification would too.
  check('9 without window focus the Quest chat is not watched (toast and notification)', (await cue()).n === 1 && notes().length === before9w + 1, `${JSON.stringify(await cue())} ${notes().length - before9w}`);
  await setPanel(false);

  // ----- 10. the Test button -----
  const before10 = notes().length;
  const test1 = await evAsync('window.bar.testNotify().then(r=>JSON.stringify(r))');
  check('10 Test: main answers native true and logs a test line', test1 === '{"native":true}' && await waitNotes(before10 + 1, 5000) && notes().at(-1).kind === 'test' && notes().at(-1).title === 'Notifications are on', `${test1} ${JSON.stringify(notes().at(-1))}`);
  await setPanel(true);
  await clickTab('Status');
  await ev('document.getElementById("notify-test").click()');
  const sentNote = () => ev('document.getElementById("notify-test-note")?.textContent || ""');
  const sentOk = await until(async () => /Sent/.test(await sentNote()));
  check('10 Test button: the note says Sent and the toast shows', sentOk && (await waitCue(5000)), await sentNote());
  await setPanel(false);

  // ----- 11. hostile IPC: the renderer cannot make main show anything -----
  const before11 = notes().length;
  await evAsync('(async()=>{window.bar.setNotifyView({tab:"x".repeat(500),wsId:{a:1},agentId:12});window.bar.setNotifyView(null);window.bar.setNotifyView([1]);return true})()');
  await sleep(500);
  check('11 malformed views are ignored (no crash, nothing shown)', notes().length === before11 && (await ev('typeof window.bar.showNotification')) === 'undefined');

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  // ----- 12. the spam limit and the repeat filter (own launch: 3 per minute, identical text 60 s) -----
  await restart({ CBH_NOTIFY_MAX_PER_MIN: '3', CBH_NOTIFY_DEDUPE_MS: '60000' });
  await ev('globalThis.__cbhIdleMs = 3600000');
  fs.rmSync(logFile, { force: true });
  await sendText('NOTIFYFAIL one');
  check('12 limit: the first failure notifies', await waitNotes(1, 10000));
  await idle();
  await sendText('NOTIFYFAIL two');
  await sleep(3500);
  await idle();
  check('12 repeat: the identical text is not shown natively twice', notes().length === 1, `${notes().length}`);
  await sendText('/alpha NOTIFYFAIL');
  check('12 limit: a different failure notifies', await waitNotes(2, 10000));
  await idle();
  await sendText('/beta NOTIFYFAIL');
  check('12 limit: the third (still within 3 per minute) notifies', await waitNotes(3, 10000));
  await idle();
  await sendText('NOTIFYLONG q');
  await until(async () => (await logText()).includes('long done'), 12000);
  await idle();
  await sleep(2000);
  check('12 limit: the fourth in a minute gets no native notification', notes().length === 3, `${notes().length}`);
  check('12 limit: but the in-app bubble still shows it', /notifysim finished/.test(await bubbleText()), await bubbleText());
  check('12 no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  // ----- 13. a focused window with the panel open: only what is NOT on screen is announced, and never natively -----
  await restart({ CBH_NOTIFY_FOCUS: '1' });
  await ev('globalThis.__cbhIdleMs = 3600000');
  fs.rmSync(logFile, { force: true });
  await setPanel(true);
  await sendText('NOTIFYLONG watched');
  await until(async () => (await logText()).includes('long done'), 12000);
  await idle();
  await sleep(1800);
  check('13 watching the Quest chat (panel open, focused): no toast and no notification', (await cue()).n === 0 && notes().length === 0, `${JSON.stringify(await cue())} ${JSON.stringify(notes())}`);
  await clickTab('Status');
  await sendText('NOTIFYLONG elsewhere');
  check('13 on another tab: the toast shows', await waitCue(15000));
  await sleep(500);
  check('13 ...but no system notification (you are looking at the panel)', notes().length === 0, `${notes().length}`);
  await idle();
  await click('.notify-x');
  await clickTab('Expedition');
  await sendText('/alpha NOTIFYLONG agenttab');
  await until(async () => (await logText()).includes('is working in its own tab'), 8000);
  await sleep(300);
  // Quest is open, the agent's tab is not: its result is not on screen, so it is announced.
  check('13 an agent finishing while you read Quest: toast with Show', await waitCue(15000) && /alpha finished/.test((await cue()).text));
  await click('.notify-show');
  await sleep(600);
  check('13 Show opens that agent\'s tab', await ev('document.querySelector(".agent-tab.active")?.childNodes[0]?.textContent?.trim()') === 'alpha');
  check('13 no page errors', pageErrors.length === 0, pageErrors.join(' | '));
} catch (err) {
  console.log(`FAIL  simulation error: ${err.message}`);
  results.push(false);
} finally {
  stopApp();
  fs.rmSync(work, { recursive: true, force: true });
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${outDir}`);
process.exit(failed ? 1 : 0);
