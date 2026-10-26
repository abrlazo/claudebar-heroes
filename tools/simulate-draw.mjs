// Focused simulation of `/draw <description>`: the real app in an isolated user-data folder against
// tools/fake-draw.mjs (a fake `claude` that answers one-shot asks by a marker in the description), driven over the
// Chrome DevTools protocol. Covers the drawing and its canvas in both themes, the fixed failure phrases, timeout,
// Cancel, one drawing at a time, the argv and folder of the ask, a run and a queue going on during a drawing, Stop,
// what settings.json keeps (size, the newest 12, failures, forged messages), a relaunch, the archive, forged IPC,
// an agent named draw, images with /draw, the Ask chat and the CSP.
// What the drawings look like can only be judged by eye (quality depends on the model's grid): the screenshots
// of one drawing in both themes are written to the --out folder for that.
//
// Usage: npm run simulate:draw [-- --out <screenshot-dir>]   (builds first). Exit code 1 if a check fails.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = createRequire(import.meta.url)('electron');
const outFlag = process.argv.indexOf('--out');
const outDir = outFlag > -1 ? path.resolve(process.argv[outFlag + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-draw-shots-'));
fs.mkdirSync(outDir, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-drawsim-'));
const port = 9600 + Math.floor(Math.random() * 90);

const fake = path.join(work, 'fake-claude.sh');
fs.writeFileSync(fake, `#!/bin/bash\nexec "$FAKE_NODE" "${path.join(root, 'tools', 'fake-draw.mjs')}" "$@"\n`, { mode: 0o755 });
const runsFile = path.join(work, 'runs.txt');
const argsFile = path.join(work, 'args.txt');
const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

const project = path.join(work, 'project');
fs.mkdirSync(path.join(project, '.claude', 'agents'), { recursive: true });
fs.writeFileSync(path.join(project, '.claude', 'agents', 'alpha.md'), '---\nname: alpha\ndescription: Simulated alpha agent\n---\n\nYou are alpha.\n');
const userData = path.join(work, 'userData');
fs.mkdirSync(userData);
const settingsFile = path.join(userData, 'settings.json');
fs.writeFileSync(settingsFile, JSON.stringify({
  permissionMode: 'default', windowPos: null, theme: 'dark', panelHeight: 500, activeId: 'draw-ws',
  workspaces: [{
    id: 'draw-ws', path: project, name: 'drawsim', heroSeed: 'draw-seed',
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
const launch = () => {
  const child = spawn(electronBin, [root, `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
    env: { ...process.env, CBH_NOTIFY_OFF: '1', CLAUDE_BIN: fake, FAKE_NODE: process.execPath, FAKE_RUNS: runsFile, FAKE_ARGS: argsFile, DRAW_TIMEOUT_MS: '4000' }, stdio: 'ignore',
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
  await send('DOM.enable');
}
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value;
const evAsync = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(s.result.data, 'base64'));
};
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await sleep(150); } return false; };

const click = (selector) => ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
const TA = '#tab-project-chat textarea';
const ATA = '#tab-general-chat textarea';
const setText = (sel, text) => ev(`(()=>{const t=document.querySelector(${JSON.stringify(sel)});
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(text)});
  t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const key = (sel, k) => ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new KeyboardEvent("keydown",{key:${JSON.stringify(k)},bubbles:true,cancelable:true}))`);
// Types the text in the Expedition composer and sends it (Esc first closes the "/" popup so Enter sends).
async function say(text, sel = TA) {
  await setText(sel, text);
  await sleep(120);
  await key(sel, 'Escape');
  await click(sel === TA ? '#tab-project-chat .send' : '#tab-general-chat .send');
}
// While a run is busy the send button is Stop, so Enter is how a message goes (it queues, or a "/draw" runs at once).
async function sayEnter(text) {
  await setText(TA, text);
  await sleep(120);
  await key(TA, 'Enter');
}
const awake = () => ev('!document.getElementById("hero").classList.contains("sleeping")');
const idle = (ms = 20000) => until(async () => !(await awake()), ms);
const logText = (tab = '#tab-project-chat') => ev(`document.querySelector(${JSON.stringify(tab + ' .msg-log')})?.innerText || ''`);
const canvases = (tab = '#tab-project-chat') => ev(`document.querySelectorAll(${JSON.stringify(tab + ' .pixel-art-canvas')}).length`);
const pending = (tab = '#tab-project-chat') => ev(`!!document.querySelector(${JSON.stringify(tab + ' .draw-pending')})`);
const starts = () => readLines(argsFile).map((l) => JSON.parse(l));
const asks = () => starts().filter((s) => s.mode === 'ask');
const savedMessages = () => { try { return JSON.parse(fs.readFileSync(settingsFile, 'utf8')).workspaces[0].messages; } catch { return null; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const lastCanvas = (tab = '#tab-project-chat') => ev(`(()=>{const all=document.querySelectorAll(${JSON.stringify(tab + ' .pixel-art-canvas')});const c=all[all.length-1];if(!c)return null;
  const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let filled=0,hash=0;for(let i=0;i<d.length;i+=4){if(d[i+3]>0)filled++;hash=(hash*31+d[i]+d[i+1]*7+d[i+2]*13+d[i+3])>>>0;}
  return JSON.stringify({w:c.width,h:c.height,filled,hash,cssW:c.style.width,aria:c.getAttribute('aria-label')});})()`).then((j) => (j ? JSON.parse(j) : null));
const cardBg = () => ev('getComputedStyle(document.querySelector("#tab-project-chat .pixel-art")).backgroundColor');
const theme = (t) => ev(`document.body.classList.remove("theme-dark","theme-light");document.body.classList.add("theme-${t}")`);
const pasteImage = () => evAsync(`(async()=>{
  const c=document.createElement('canvas'); c.width=40; c.height=30; const g=c.getContext('2d'); g.fillStyle='#c33'; g.fillRect(0,0,40,30);
  const blob=await new Promise((r)=>c.toBlob(r,'image/png')); const dt=new DataTransfer(); dt.items.add(new File([blob],'p.png',{type:'image/png'}));
  const t=document.querySelector(${JSON.stringify(TA)}); t.focus();
  t.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true})); return 1;})()`);
const chips = () => ev('document.querySelectorAll("#tab-project-chat .attach-chip img").length');
const queueCount = () => ev('document.querySelectorAll(".queue-bar .queue-item").length');

const EXPECT_ARGV = ['-p', '--output-format', 'json', '--tools', '', '--max-turns', '1', '--no-session-persistence', '--disable-slash-commands', '--permission-mode', 'default', '--model', 'haiku'];
let okCount = 0; // drawings that succeeded in the Expedition chat

try {
  app = launch();
  await connect();
  await sleep(1500);
  await click('#toggle-panel');
  await sleep(900);
  await ev('globalThis.__cbhIdleMs = 3600000');

  // ----- 1. a drawing: user line, pending row, canvas, both themes -----
  check('1 the "/" popup offers /draw (app command)', await (async () => {
    await setText(TA, '/dra');
    await sleep(500);
    const t = await ev('document.querySelector(".command-popup")?.innerText || ""');
    await setText(TA, '');
    return /\/draw/.test(t) && /pixel-art/.test(t);
  })());
  await say('/draw DRAWOK a tiny cat');
  check('1 the typed line is saved as a user message, then the pending row shows with Cancel', await until(() => pending(), 4000) && /\/draw DRAWOK a tiny cat/.test(await logText()) && await ev('!!document.querySelector(".draw-pending .draw-cancel")'));
  check('1 the canvas appears (16x16), pending row gone, caption from the user text', await until(async () => (await canvases()) === 1, 8000) && !(await pending()));
  okCount += 1;
  const c1 = await lastCanvas();
  check('1 canvas size, whole-number scale, label, and pixels are not all transparent (196 filled)', c1 && c1.w === 16 && c1.h === 16 && c1.filled === 196 && parseInt(c1.cssW, 10) % 16 === 0 && /DRAWOK a tiny cat/.test(c1.aria), JSON.stringify(c1));
  const darkBg = await cardBg();
  await shot('draw-1-dark');
  await theme('light');
  await sleep(300);
  const lightBg = await cardBg();
  const c1l = await lastCanvas();
  await shot('draw-2-light');
  check('1 light theme: card colours differ, canvas data is the same', darkBg !== lightBg && c1l.hash === c1.hash, `${darkBg} / ${lightBg}`);
  await theme('dark');
  check('1 the drawing did not wake the hero or leave a run', !(await awake()) && (await ev('!document.querySelector("#tab-project-chat .stop")')));
  let askList = asks();
  check('1 the ask: tools off, no session, haiku, no --resume; folder is draw-cwd, not the project', askList.length === 1
    && JSON.stringify(askList[0].argv) === JSON.stringify(EXPECT_ARGV) && !askList[0].argv.includes('--resume') && askList[0].cwd.endsWith('draw-cwd') && !askList[0].cwd.startsWith(project), JSON.stringify(askList[0]));
  await say('/draw DRAWBIG a castle');
  check('1 a 32x32 drawing is drawn too', await until(async () => (await canvases()) === 2, 8000) && (await lastCanvas())?.w === 32);
  okCount += 1;

  // ----- 2. empty, failures (fixed phrases only), timeout -----
  const before2 = starts().length;
  await say('/draw    ');
  check('2 /draw with no text: usage line, nothing started', await until(async () => /Tell me what to draw/.test(await logText()), 4000) && starts().length === before2);
  const phrases = [
    ['DRAWPROSE', 'The drawing could not be read. Try /draw again or describe it differently.'],
    ['DRAWEVIL', 'The drawing could not be read. Try /draw again or describe it differently.'],
    ['DRAWHUGE', 'The drawing could not be read. Try /draw again or describe it differently.'],
    ['DRAWFAIL', 'Claude could not draw that.'],
  ];
  for (const [marker, phrase] of phrases) {
    const n = (await logText()).split(phrase).length - 1;
    await say(`/draw ${marker} nope`);
    check(`2 ${marker}: exactly the fixed phrase, never the model text`, await until(async () => (await logText()).split(phrase).length - 1 === n + 1, 12000) && !/x{20}|only know words|boom/.test(await logText()));
  }
  check('2 failures drew nothing', (await canvases()) === 2);
  const asksBefore = asks().length;
  await say('/draw DRAWSLOW takes forever');
  await until(() => pending(), 4000);
  await until(() => asks().length === asksBefore + 1, 4000);
  const slowStart = asks().at(-1);
  await say('/draw DRAWQUICK second one');
  check('2 a second /draw while one runs is refused, the first is untouched', await until(async () => /Already drawing, wait for it\./.test(await logText()), 4000) && await pending() && alive(slowStart.pid));
  await click('#tab-project-chat .draw-cancel');
  check('2 Cancel: "Drawing cancelled.", the pending row is gone and the fake process is killed', await until(async () => /Drawing cancelled\./.test(await logText()), 5000) && !(await pending()) && await until(() => !alive(slowStart.pid), 5000));
  const asksBefore2 = asks().length;
  await say('/draw DRAWSLOW again');
  await until(() => asks().length === asksBefore2 + 1, 4000);
  check('2 timeout (4 s through DRAW_TIMEOUT_MS): the fixed phrase', await until(async () => /Drawing took too long\. Try a simpler description\./.test(await logText()), 12000) && await until(() => !alive(asks().at(-1).pid), 5000));

  // ----- 3. a drawing during a run; the queue is untouched; Stop does not cancel it -----
  await say('BRIEFRUN long one');
  await until(async () => await awake(), 6000);
  await setText(TA, 'queued while busy');
  await sleep(120);
  await key(TA, 'Enter');
  check('3 a message typed during the run waits in the queue', await until(async () => (await queueCount()) === 1, 4000));
  await sayEnter('/draw DRAWOK during the run');
  check('3 a drawing during a run works and the run is not blocked', await until(async () => (await canvases()) === 3, 8000) && await awake());
  okCount += 1;
  check('3 the queue is unchanged by it', (await queueCount()) === 1);
  check('3 the run ends normally and the queued message drains', await until(() => readLines(runsFile).some((l) => l.includes('queued while busy')), 25000));
  await idle();
  await say('BRIEFRUN second');
  await until(async () => await awake(), 6000);
  const asksBefore3 = asks().length;
  await sayEnter('/draw DRAWSLOW while running');
  await until(() => pending(), 4000);
  await until(() => asks().length === asksBefore3 + 1, 4000);
  await click('#tab-project-chat .stop');
  await sleep(1200);
  const stillPending = await pending();
  const stillAlive = alive(asks().at(-1).pid);
  check('3 Stop on the run ends it but does not cancel the drawing', stillPending && stillAlive && await idle(8000), `pending ${stillPending}, alive ${stillAlive}`);
  await click('#tab-project-chat .draw-cancel');
  await until(async () => /Drawing cancelled\./.test(await logText()), 5000);
  await idle();
  await click('#tab-project-chat .queue-bar .queue-btn.queue-clear').catch(() => {});

  // ----- 4. images with /draw, forged IPC -----
  await pasteImage();
  await until(async () => (await chips()) === 1, 8000);
  const before4 = starts().length;
  await setText(TA, '/draw DRAWQUICK with a picture');
  await sleep(120);
  await key(TA, 'Escape');
  await click('#tab-project-chat .send');
  check('4 /draw with an image attached is refused: meta line, draft and chip stay, nothing started',
    await until(async () => /Images can only go with an ordinary message/.test(await logText()), 4000) && (await chips()) === 1
    && (await ev(`document.querySelector(${JSON.stringify(TA)}).value`)) === '/draw DRAWQUICK with a picture' && starts().length === before4);
  await click('#tab-project-chat .attach-x');
  await setText(TA, '');
  const forged = await evAsync(`(async()=>JSON.stringify([await window.bar.makeDrawing(123), await window.bar.makeDrawing('x'.repeat(5000)), await window.bar.makeDrawing(''), await window.bar.makeDrawing('   '), await window.bar.makeDrawing({a:1})]))()`).then(JSON.parse);
  check('4 forged makeDrawing (number, 5000 characters, empty, spaces, object): refused with the fixed message, no process', forged.every((r) => r.ok === false && r.code === 'invalid' && /Tell me what to draw/.test(r.message)) && starts().length === before4);

  // ----- 5. the Ask chat -----
  await click('#ask-tab');
  await sleep(400);
  await say('/draw DRAWQUICK ask chat cat', ATA);
  check('5 Ask chat: /draw shows the canvas in the Ask chat', await until(async () => (await canvases('#tab-general-chat')) === 1, 8000));
  const askCanvas = await lastCanvas('#tab-general-chat');
  check('5 Ask chat: the same 16x16 pixels', askCanvas && askCanvas.w === 16 && askCanvas.filled === 196);
  await click('.panel-tabs .tab');
  await sleep(300);

  // ----- 6. an agent named draw wins over /draw -----
  fs.writeFileSync(path.join(project, '.claude', 'agents', 'draw.md'), '---\nname: draw\ndescription: Simulated draw agent\n---\n\nYou are draw.\n');
  const canvasesBefore = await canvases();
  await say('/draw agent task here');
  check('6 an agent file named draw runs as an agent (own process, not a drawing)', await until(() => readLines(runsFile).some((l) => l.includes('agent task here')), 10000)
    && starts().some((s) => s.mode === 'stream' && s.argv.includes('--agent') && s.argv.includes('draw')) && (await canvases()) === canvasesBefore);
  await idle();
  fs.rmSync(path.join(project, '.claude', 'agents', 'draw.md'));

  // ----- 7. many drawings: the newest 12 keep their art -----
  for (let i = okCount; i < 13; i++) {
    const n = await canvases();
    await say(`/draw DRAWQUICK number ${i}`);
    await until(async () => (await canvases()) === n + 1, 8000);
    okCount += 1;
  }
  // Forged messages go through main's cleaning too.
  await ev(`(()=>{const id=${JSON.stringify('draw-ws')};
    window.bar.addMessage(id,{kind:'art',text:'forged colours',art:{palette:['red','url(javascript:1)'],rows:['xxxxxxxx','xxxxxxxx','xxxxxxxx','xxxxxxxx','xxxxxxxx','xxxxxxxx','xxxxxxxx','xxxxxxxx']}});
    window.bar.addMessage(id,{kind:'assistant',text:'plain with art',art:{palette:['#000000','#ffffff'],rows:[]},artGone:true});
  })()`);
  const flushed = await until(() => { const m = savedMessages(); return m && m.some((x) => x.text === 'plain with art'); }, 16000);
  const msgs = savedMessages() || [];
  const arts = msgs.filter((m) => m.kind === 'art');
  const withArt = arts.filter((m) => m.art);
  check('7 settings.json saved the drawings: the newest 12 keep their grid, older ones become a label', flushed && withArt.length === 12 && arts.some((m) => m.artGone), `${arts.length} art messages, ${withArt.length} with a grid`);
  check('7 the 13th drawing turned the first into a label (artGone, text kept, no grid)', arts.some((m) => m.artGone && !m.art && /DRAWOK a tiny cat/.test(m.text)));
  check('7 each saved drawing is under 2 KB', withArt.length > 0 && withArt.every((m) => JSON.stringify(m).length < 2000));
  check('7 failures, cancels and timeouts saved no art and no pending row', arts.filter((m) => m.text !== 'forged colours').every((m) => /DRAWOK|DRAWBIG|DRAWQUICK/.test(m.text)) && !msgs.some((m) => /nope|forever|again/.test(m.text) && m.kind === 'art'));
  const forgedMsg = msgs.find((m) => m.text === 'forged colours');
  check('7 a forged art message with bad colours is stored cleaned (artGone, no colours)', forgedMsg?.kind === 'art' && forgedMsg.artGone === true && !forgedMsg.art && !JSON.stringify(forgedMsg).includes('javascript'));
  const plain = msgs.find((m) => m.text === 'plain with art');
  check('7 art fields on an assistant message are stripped', plain && !('art' in plain) && !('artGone' in plain));
  const rawSettings = fs.readFileSync(settingsFile, 'utf8');
  check('7 the archive holds no art, and settings.json stays small', !(JSON.parse(rawSettings).workspaces[0].archive || []).some((a) => (a.messages || []).some((m) => m.kind === 'art')) && rawSettings.length < 200_000, `${rawSettings.length} bytes`);

  // ----- 8. relaunch shows the saved art; the CSP is unchanged -----
  stopApp();
  await sleep(1200);
  app = launch();
  await connect();
  await sleep(1500);
  await click('#toggle-panel');
  await sleep(900);
  check('8 after a relaunch the saved drawings are shown (12 canvases) and the oldest is a label', await until(async () => (await canvases()) === withArt.length, 8000) && /\[drawing: /.test(await logText()), `${await canvases()} canvases`);
  const csp = await ev('document.querySelector("meta[http-equiv=Content-Security-Policy]")?.content || ""');
  let htmlUnchanged = false;
  try { execFileSync('git', ['diff', '--quiet', '--', 'src/renderer/index.html'], { cwd: root }); htmlUnchanged = true; } catch { /* changed */ }
  check('8 the CSP is unchanged (index.html untouched, data: images only, no blob:)', htmlUnchanged && /img-src 'self' data:/.test(csp) && !/blob:/.test(csp), csp);
  check('8 no page errors', pageErrors.length === 0, pageErrors.join(' | '));
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
