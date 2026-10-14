// Focused simulation of the workflow pipeline pane: the real app in an isolated user-data folder, driven over the
// Chrome DevTools protocol, with the fake claude of tools/fake-perm.mjs (prompts PIPELONG, PIPETEXT, PIPEQUICK,
// PIPEFAIL for the runs, PERMSTALL for a permission card). Test seams (main's environment only): CBH_WINDOW_LOG,
// CBH_WINDOW_COMMANDS (the `tray` line shows the window again), CBH_FORCE_PIPELINE_MODE (right | left | inline) and
// CBH_NOTIFY_OFF=1 (no notification or bubble while it runs). The renderer test flag `__cbhCountRenders` makes the pane
// publish its render count (`data-renders`) and the number of live elapsed timers (`__cbhPipelineTimers`).
// Covers: the pane for a run, a chain, a permission card, a failure, the linger, closing it for a burst, the three
// placements with the strip never moving on screen, the drawer beside it, hide / show, themes and reduced motion, the
// render guard while text streams, and listener cleanup.
//
// Usage: npm run simulate:pipeline [-- --out <screenshot-dir>]   (builds first). Exit code 1 if a check fails.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = createRequire(import.meta.url)('electron');
const outFlag = process.argv.indexOf('--out');
const outDir = outFlag > -1 ? path.resolve(process.argv[outFlag + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-pipeline-shots-'));
fs.mkdirSync(outDir, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-pipelinesim-'));
let port = 9700 + Math.floor(Math.random() * 90);
const fake = path.join(work, 'fake-claude.sh');
fs.writeFileSync(fake, `#!/bin/bash\nexec "$FAKE_NODE" "${path.join(root, 'tools', 'fake-perm.mjs')}" "$@"\n`, { mode: 0o755 });
const winLog = path.join(work, 'window.log');
const cmdFile = path.join(work, 'commands.txt');
const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

const project = path.join(work, 'project');
fs.mkdirSync(path.join(project, '.claude', 'agents'), { recursive: true });
for (const n of ['alpha', 'beta']) fs.writeFileSync(path.join(project, '.claude', 'agents', `${n}.md`), `---\nname: ${n}\ndescription: Simulated ${n} agent\n---\n\nYou are ${n}.\n`);
const userData = path.join(work, 'userData');
fs.mkdirSync(userData);
const settingsFile = path.join(userData, 'settings.json');
const writeSettings = (pos) => fs.writeFileSync(settingsFile, JSON.stringify({
  permissionMode: 'default', windowPos: pos, theme: 'dark', panelHeight: 500, activeId: 'pipe-ws',
  workspaces: [{
    id: 'pipe-ws', path: project, name: 'pipesim', heroSeed: 'pipe-seed',
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
let relaunching = false;
const launch = (env = {}) => {
  const child = spawn(electronBin, [root, `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
    env: { ...process.env, CLAUDE_BIN: fake, FAKE_NODE: process.execPath, CBH_WINDOW_LOG: winLog, CBH_WINDOW_COMMANDS: cmdFile, CBH_NOTIFY_OFF: '1', ...env }, stdio: 'ignore',
  });
  child.on('exit', (code, signal) => { if (!stopping.has(child) && !relaunching) loseConnection(`the app exited by itself (code ${code}, signal ${signal})`); });
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
  ws = undefined;
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
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(120); } return false; };
const click = (selector) => ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
const type = (text) => ev(`(()=>{const t=document.querySelector("#tab-project-chat textarea");
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(text)});
  t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const sendText = async (text) => { await type(text); await sleep(150); await click('#tab-project-chat .send'); };
const winLines = () => readLines(winLog).map((l) => JSON.parse(l));
const vlines = () => winLines().filter((l) => l.event === 'visibility');
const lastV = () => vlines().at(-1) ?? {};
const command = (line) => fs.appendFileSync(cmdFile, `${line}\n`);
const logText = () => ev('document.querySelector("#tab-project-chat .msg-log")?.innerText || ""');
const panelOpen = () => ev('!document.getElementById("panel").classList.contains("hidden")');
const setPanel = async (open) => { if ((await panelOpen()) !== open) { await click('#toggle-panel'); await sleep(700); } };
const body = (cls) => ev(`document.body.classList.contains(${JSON.stringify(cls)})`);
// The pane as the page shows it.
const pane = () => ev(`(()=>{const p=document.getElementById("pipeline-pane");if(!p)return null;
  return JSON.stringify({cls:p.className,headline:p.querySelector(".pipeline-headline")?.textContent||"",renders:p.dataset.renders||"",
    nodes:[...p.querySelectorAll(".pipeline-node")].map(n=>({id:n.dataset.node,state:n.dataset.state,label:n.querySelector(".pipeline-label")?.textContent||"",detail:n.querySelector(".pipeline-detail")?.textContent||""}))})})()`).then((v) => (v ? JSON.parse(v) : null));
const node = (p, id) => p?.nodes.find((n) => n.id === id);
const waitPane = (fn, ms = 15000) => until(async () => { const p = await pane(); return !!p && fn(p); }, ms);
const waitNoPane = (ms = 20000) => until(async () => (await pane()) === null, ms);
// Window and strip geometry on screen.
const geo = () => ev(`(()=>{const s=document.getElementById("strip").getBoundingClientRect();return JSON.stringify({sx:window.screenX,sy:window.screenY,w:window.outerWidth,h:window.outerHeight,strip:Math.round(window.screenX+s.left),stripTop:Math.round(window.screenY+s.top),availL:screen.availLeft||0,availW:screen.availWidth})})()`).then(JSON.parse);
const lightTheme = async (on) => { await ev(`document.body.classList.toggle("theme-light", ${on});document.body.classList.toggle("theme-dark", ${!on})`); await sleep(500); };
const timers = () => ev('globalThis.__cbhPipelineTimers || 0');

const restart = async (env, pos) => {
  stopApp();
  await killOwn();
  await sleep(1200);
  fs.rmSync(winLog, { force: true });
  fs.rmSync(cmdFile, { force: true });
  writeSettings(pos);
  port += 1;
  app = launch(env);
  await connect();
  await sleep(1500);
  await ev('globalThis.__cbhIdleMs = 3600000; globalThis.__cbhCountRenders = true; true');
};
const finishRun = async (text) => until(async () => (await logText()).includes(text), 20000);

try {
  // The screen the simulation runs on decides the strip's spot, so the wanted placement is certain for every case.
  writeSettings({ x: 700, y: 400 });
  app = launch({});
  await connect();
  await sleep(1500);
  await ev('globalThis.__cbhIdleMs = 3600000; globalThis.__cbhCountRenders = true; true');
  const screenInfo = await geo();
  const availL = screenInfo.availL;
  const availR = availL + screenInfo.availW;
  const wide = availR - (700 + 560) >= 288 + 8 && 700 - availL >= 608; // x=700: drawer left and pipeline right both fit
  console.log(`      screen: ${availL}..${availR}; x=700 ${wide ? 'fits both panes' : 'is too narrow for the combined cases (they are skipped)'}`);

  // ----- 1. a run: the pane appears, shows the Quest and its tool, the strip does not move -----
  await setPanel(true);
  const g0 = await geo();
  check('1 panel open without work: no pane, window is 560 wide', (await pane()) === null && g0.w === 560, JSON.stringify(g0));
  await sendText('PIPELONG one');
  check('1 the pane appears with a running Quest node', await waitPane((p) => node(p, 'quest')?.state === 'running'));
  check('1 a tool call updates the Quest detail', await waitPane((p) => /^Bash: step \d/.test(node(p, 'quest')?.detail || '')));
  const g1 = await geo();
  const mode1 = (await pane()).cls.split(' ').find((c) => ['left', 'right', 'inline'].includes(c));
  check('1 the pane is a side pane or inline, body has pipe-open and pipe-<mode>', !!mode1 && (await body('pipe-open')) && (await body(`pipe-${mode1}`)), mode1);
  check('1 the window grew by 288 for a side pane (0 inline) and the strip stayed on screen', g1.w === (mode1 === 'inline' ? 560 : 848) && g1.strip === g0.strip && g1.stripTop === g0.stripTop, `${JSON.stringify(g0)} -> ${JSON.stringify(g1)}`);
  await shot('pipeline-1-run-dark');
  await lightTheme(true);
  await shot('pipeline-2-run-light');
  const bgLight = await ev('getComputedStyle(document.getElementById("pipeline-pane")).backgroundColor');
  await lightTheme(false);
  const bgDark = await ev('getComputedStyle(document.getElementById("pipeline-pane")).backgroundColor');
  check('10 the light theme renders another background than the dark one', bgLight !== bgDark, `${bgLight} vs ${bgDark}`);
  const p1 = await pane();
  check('1 the pane is interactive, plain text only, never focused', /interactive/.test(p1.cls) && (await ev('document.activeElement?.closest?.("#pipeline-pane") === null && !document.querySelector("#pipeline-pane img, #pipeline-pane script")')));
  check('5 the run ends and the pane lingers with the final state, then closes (window back to 560)', await finishRun('long done') && await waitPane((p) => node(p, 'quest')?.state === 'done', 5000) && await waitNoPane(9000) && (await geo()).w === 560);
  check('5 the strip is where it was after the shrink', (await geo()).strip === g0.strip);

  // ----- 2. a chain: the second step waits, then runs; both end done -----
  await sendText('/alpha PIPEQUICK a && /beta PIPEQUICK b');
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 25000) {
    const p = await pane();
    if (p) {
      for (const n of p.nodes) seen.add(`${n.id.replace(/:[^:]*$/, '').replace(/^agent:.*/, 'agent')}=${n.state}`);
      const agents = p.nodes.filter((n) => n.id.startsWith('agent:'));
      if (agents.length === 2 && agents.every((n) => n.state === 'done')) break;
    }
    await sleep(150);
  }
  const pc = await pane();
  check('2 chain: an agent was shown running', [...seen].includes('agent=running'), [...seen].join(','));
  check('2 chain: the waiting step turned into a node and both end done', pc?.nodes.filter((n) => n.id.startsWith('agent:') && n.state === 'done').length === 2 && !pc.nodes.some((n) => n.id.startsWith('chain:')), JSON.stringify(pc?.nodes.map((n) => `${n.label}=${n.state}`)));
  check('2 chain: labels are the agent names', !!pc?.nodes.find((n) => n.label === 'alpha') && !!pc?.nodes.find((n) => n.label === 'beta'));
  check('2 chain: a waiting step was shown at some point', [...seen].some((s) => s.startsWith('chain') && s.endsWith('=waiting')), [...seen].join(','));
  await shot('pipeline-3-chain');
  await waitNoPane(12000);

  // ----- 3. a permission card: the node asks, the strip glows, answering clears it -----
  await sendText('PERMSTALL now');
  check('3 the Quest node is asking and the strip is amber', await waitPane((p) => node(p, 'quest')?.state === 'asking') && await body('perm-pending'));
  check('3 the headline says it waits for an OK', /waiting for OK/.test((await pane()).headline), (await pane()).headline);
  await shot('pipeline-4-asking');
  await click('.perm-allow');
  check('3 answering through the card clears the asking state', await waitPane((p) => node(p, 'quest')?.state !== 'asking', 8000) && !(await body('perm-pending')));
  await finishRun('stall answered');
  await waitNoPane(12000);

  // ----- 4. a failure -----
  await sendText('PIPEFAIL now');
  check('4 a failed run shows a failed Quest node', await waitPane((p) => node(p, 'quest')?.state === 'failed', 15000));
  await shot('pipeline-5-failed');
  await waitNoPane(12000);

  // ----- 9. closing the pane for a burst -----
  await sendText('PIPELONG two');
  await waitPane((p) => node(p, 'quest')?.state === 'running');
  await click('#pipeline-pane .pipeline-close');
  check('9 the x closes the pane for this burst, the window shrinks, a "Pipeline" pill appears', await waitNoPane(4000) && (await until(async () => (await geo()).w === 560, 4000)) && (await ev('!!document.getElementById("pipeline-open")')));
  await click('#pipeline-open');
  check('9 the pill brings the pane back', await waitPane((p) => !!node(p, 'quest')));
  await click('#pipeline-pane .pipeline-close');
  await waitNoPane(4000);
  await finishRun('long done');
  await sleep(5500);
  check('9 after the burst the pill is gone', !(await ev('!!document.getElementById("pipeline-open")')));
  await sendText('PIPEQUICK three');
  check('9 a new run reopens the pane', await waitPane((p) => node(p, 'quest')?.state === 'running'));
  await finishRun('quick done');
  await waitNoPane(12000);

  // ----- 11. render guard: text streams, the pane does not render -----
  await sendText('PIPETEXT now');
  await waitPane((p) => node(p, 'quest')?.state === 'running');
  await sleep(600);
  const r0 = (await pane()).renders;
  const len0 = (await logText()).length;
  await sleep(2000);
  const r1 = (await pane())?.renders;
  const len1 = (await logText()).length;
  check('11 while text streams the pane renders 0 times', r0 !== '' && r0 === r1, `${r0} -> ${r1}; text ${len0} -> ${len1}`);
  await finishRun('chunk 39');
  await waitNoPane(12000);

  // ----- 12. cleanup: toggling the panel leaves no extra timers -----
  await sendText('PERMSTALL again');
  await waitPane((p) => node(p, 'quest')?.state === 'asking');
  for (let i = 0; i < 20; i++) { await click('#toggle-panel'); await sleep(450); }
  await setPanel(true);
  await waitPane((p) => !!node(p, 'quest'));
  check('12 20 toggles later exactly one elapsed timer is alive', (await timers()) === 1, String(await timers()));
  await click('.perm-allow');
  await waitNoPane(15000);
  check('12 with the pane gone no timer is left', (await timers()) === 0, String(await timers()));

  // ----- 10. reduced motion -----
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await sendText('PIPEQUICK motion');
  await waitPane((p) => node(p, 'quest')?.state === 'running');
  check('10 reduced motion: no enter animation and no pulse', (await ev('getComputedStyle(document.getElementById("pipeline-pane")).animationName')) === 'none' && (await ev('getComputedStyle(document.querySelector("#pipeline-pane .pipeline-node.running .pipeline-icon")).animationName')) === 'none');
  await send('Emulation.setEmulatedMedia', { features: [] });
  await finishRun('quick done');
  await waitNoPane(12000);

  // ----- 8. hide with the pane open, show: it is back while the run goes -----
  await sendText('PIPELONG hide');
  await waitPane((p) => node(p, 'quest')?.state === 'running');
  const nh = vlines().length;
  await click('#hide-app');
  await until(() => vlines().length > nh, 8000);
  await sleep(500);
  check('8 hide: main logged pipelineOpen false and panelOpen false', lastV().action === 'hide' && lastV().pipelineOpen === false && lastV().panelOpen === false, JSON.stringify(lastV()));
  check('8 the page dropped pipe-open and the pane is gone', !(await body('pipe-open')) && (await pane()) === null);
  command('tray');
  await until(() => lastV().action === 'show', 8000);
  await sleep(600);
  await setPanel(true);
  check('8 after a show and opening the panel the pane is back while the run goes', await waitPane((p) => node(p, 'quest')?.state === 'running', 8000));
  check('8 hiding never stopped the run', await finishRun('long done') && !/stopped|Stop/i.test(await logText()));
  await waitNoPane(12000);

  // ----- 6. each placement: window rectangle, the strip never moves, interactive, click-through gap -----
  for (const forced of ['right', 'left', 'inline']) {
    await restart({ CBH_FORCE_PIPELINE_MODE: forced }, { x: 700, y: 400 });
    await setPanel(true);
    const a = await geo();
    await sendText('PIPELONG forced');
    await waitPane((p) => node(p, 'quest')?.state === 'running');
    await sleep(500);
    const b = await geo();
    const expectedW = forced === 'inline' ? 560 : 848;
    const expectedX = forced === 'left' ? a.sx - 288 : a.sx;
    check(`6 ${forced}: window width ${expectedW} and x ${expectedX}`, b.w === expectedW && b.sx === expectedX, JSON.stringify(b));
    check(`6 ${forced}: the strip did not move on screen`, b.strip === a.strip && b.stripTop === a.stripTop, `${a.strip} -> ${b.strip}`);
    const p = await pane();
    check(`6 ${forced}: the pane has the mode class, body has pipe-${forced}, the pane is interactive`, p.cls.split(' ').includes(forced) && (await body(`pipe-${forced}`)) && /interactive/.test(p.cls));
    if (forced !== 'inline') {
      const gap = await ev(`(()=>{const pr=document.getElementById("pipeline-pane").getBoundingClientRect();const pa=document.getElementById("panel").getBoundingClientRect();
        const x=${forced === 'right' ? 'pa.right+4' : 'pa.left-4'};const el=document.elementFromPoint(x,pa.top+100);return el?.closest?.(".interactive")?null:"transparent"})()`);
      check(`6 ${forced}: the gap between panel and pane is not interactive (click-through)`, gap === 'transparent');
    }
    await shot(`pipeline-6-${forced}`);
    await finishRun('long done');
    check(`6 ${forced}: after the run the pane closes, the window shrinks and the strip is where it was`, await waitNoPane(12000) && (await until(async () => (await geo()).w === 560, 4000)) && (await geo()).strip === a.strip);
  }

  // ----- 7. drawer and pipeline together -----
  if (wide) {
    await restart({}, { x: 700, y: 400 });
    await setPanel(true);
    const a = await geo();
    await sendText('PIPELONG both');
    await waitPane((p) => node(p, 'quest')?.state === 'running');
    check('7 centred spot: the pipeline opens on the right', (await body('pipe-right')) && (await geo()).w === 848);
    await click('.archive-pill');
    await sleep(900);
    const b = await geo();
    check('7 drawer left + pipeline right: 560+608+288 wide, the strip never moved', (await body('drawer-left')) && (await body('pipe-right')) && b.w === 560 + 608 + 288 && b.strip === a.strip, JSON.stringify(b));
    await shot('pipeline-7-drawer-and-pipeline');
    await click('.archive-pill'); // close the drawer again
    await sleep(700);
    check('7 closing the drawer leaves the pipeline on the right', (await body('pipe-right')) && !(await body('drawer-open')) && (await geo()).w === 848 && (await geo()).strip === a.strip);
    await finishRun('long done');
    await waitNoPane(12000);
  }
  // The default bottom-right spot: no room on the right, so the pipeline stays inside the panel (the left is the drawer's side).
  await restart({}, { x: availR - 560 - 8, y: 400 });
  await setPanel(true);
  const c0 = await geo();
  await sendText('PIPELONG corner');
  await waitPane((p) => node(p, 'quest')?.state === 'running');
  await sleep(400);
  check('7 bottom-right spot: pipeline inline, the window did not grow and the strip did not move', (await body('pipe-inline')) && !(await body('pipe-left')) && (await geo()).w === 560 && (await geo()).strip === c0.strip, JSON.stringify(await geo()));
  await click('.archive-pill');
  await sleep(1000);
  const c1 = await geo();
  check('7 opening the drawer keeps the pipeline inline and the strip stays', (await body('drawer-left')) && (await body('pipe-inline')) && c1.w === 560 + 608 && c1.strip === c0.strip, JSON.stringify(c1));
  check('7 inline: the pane sits inside the panel', await ev('!!document.querySelector("#panel #pipeline-pane")'));
  await shot('pipeline-8-inline-with-drawer');
  await click('.archive-pill');
  await sleep(900);
  check('7 closing the drawer leaves the pipeline inline', (await body('pipe-inline')) && (await geo()).w === 560 && (await geo()).strip === c0.strip);
  await finishRun('long done');
  await waitNoPane(12000);

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
