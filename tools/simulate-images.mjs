// Focused simulation of chat image attachments: the real app in an isolated user-data folder against
// tools/fake-images.mjs (a fake `claude` that reports the image blocks it received), driven over the Chrome
// DevTools protocol. Covers the file picker, paste, refusals (bad type, too big, too many), removal, sending with
// and without text, forged and replayed ids, "/" refusal with the draft kept, the queue, an agent follow-up, what
// is saved in settings.json, the CSP and a screenshot in both themes.
//
// Usage: npm run simulate:images [-- --out <screenshot-dir>]   (builds first). Exit code 1 if a check fails.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = createRequire(import.meta.url)('electron');
const outFlag = process.argv.indexOf('--out');
const outDir = outFlag > -1 ? path.resolve(process.argv[outFlag + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-images-shots-'));
fs.mkdirSync(outDir, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-imgsim-'));
const port = 9500 + Math.floor(Math.random() * 90);

const fake = path.join(work, 'fake-claude.sh');
fs.writeFileSync(fake, `#!/bin/bash\nexec "$FAKE_NODE" "${path.join(root, 'tools', 'fake-images.mjs')}" "$@"\n`, { mode: 0o755 });
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
  permissionMode: 'default', windowPos: null, theme: 'dark', panelHeight: 500, activeId: 'img-ws',
  workspaces: [{
    id: 'img-ws', path: project, name: 'imgsim', heroSeed: 'img-seed',
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }, lastContext: 0, contextWindow: 200000,
    kills: 0, map: 'forest', sessionId: null, messages: [], agents: [],
  }],
}));

// A real, decodable PNG (so Electron's nativeImage can make the thumbnail).
const crc = (buf) => zlib.crc32(buf) >>> 0;
const chunk = (type, data) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};
function makePng(w, h, rgb) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pngBytes = makePng(40, 30, [200, 40, 40]);
const pngFile = path.join(work, 'red.png');
fs.writeFileSync(pngFile, pngBytes);
const textAsPng = path.join(work, 'notes.png');
fs.writeFileSync(textAsPng, 'this is plain text, not an image');

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
    env: { ...process.env, CBH_NOTIFY_OFF: '1', CLAUDE_BIN: fake, FAKE_NODE: process.execPath, FAKE_RUNS: runsFile, FAKE_ARGS: argsFile }, stdio: 'ignore',
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
const type = (text) => ev(`(()=>{const t=document.querySelector(${JSON.stringify(TA)});
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(text)});
  t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const enter = () => ev(`document.querySelector(${JSON.stringify(TA)}).dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}))`);
const chips = () => ev('document.querySelectorAll("#tab-project-chat .attach-chip img").length');
const chipError = () => ev('document.querySelector("#tab-project-chat .attach-error")?.textContent || ""');
const awake = () => ev('!document.getElementById("hero").classList.contains("sleeping")');
const idle = (ms = 15000) => until(async () => !(await awake()), ms);
const logText = () => ev('document.querySelector("#tab-project-chat .msg-log")?.innerText || ""');
const runs = () => readLines(runsFile);
const stage = (expr) => evAsync(`(async()=>{const b=${expr};const r=await window.bar.stageImage(b);return JSON.stringify({ok:r.ok,code:r.code,message:r.message,id:!!r.id,thumb:r.thumb?r.thumb.slice(0,23):null,len:r.thumb?r.thumb.length:0})})()`).then((j) => JSON.parse(j));

// A synthetic paste of generated JPEG/PNG files (canvas makes real ones); resolves with the byte sizes, in order.
const pasteImages = (types) => evAsync(`(async()=>{
  const sizes=[]; const dt=new DataTransfer();
  for (const [i,type] of ${JSON.stringify(types)}.entries()) {
    const c=document.createElement('canvas'); c.width=48+i; c.height=32; const g=c.getContext('2d');
    g.fillStyle='rgb('+(30*i%255)+',120,200)'; g.fillRect(0,0,48+i,32); g.fillStyle='#fff'; g.fillRect(4,4,10,10);
    const blob=await new Promise((r)=>c.toBlob(r,type));
    sizes.push(blob.size); dt.items.add(new File([blob],'pasted'+i+'.'+type.split('/')[1],{type}));
  }
  const t=document.querySelector(${JSON.stringify(TA)}); t.focus();
  t.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  return JSON.stringify(sizes);
})()`).then((j) => JSON.parse(j));

async function setFiles(files) {
  const doc = await send('DOM.getDocument', { depth: 0 });
  const q = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#tab-project-chat .attach-input' });
  await send('DOM.setFileInputFiles', { files, nodeId: q.result.nodeId });
}
const cspOf = () => ev('document.querySelector("meta[http-equiv=Content-Security-Policy]")?.content || ""');

try {
  app = launch();
  await connect();
  await sleep(1500);
  await click('#toggle-panel');
  await sleep(900);
  await ev('globalThis.__cbhIdleMs = 3600000');

  // ----- 1. the picker, a paste, the refusals -----
  check('1 only the Expedition composer has an attach button (not the Ask chat)', await ev('document.querySelectorAll(".attach-btn").length === 1 && !!document.querySelector("#tab-project-chat .attach-btn")'));
  await setFiles([pngFile]);
  check('1 picker: a PNG becomes a chip with a JPEG thumbnail made by main', await until(async () => (await chips()) === 1) && await ev('document.querySelector("#tab-project-chat .attach-chip img").src.startsWith("data:image/jpeg;base64,")'));
  const pasted = await pasteImages(['image/jpeg']);
  check('1 paste: a JPEG from the clipboard becomes a second chip', await until(async () => (await chips()) === 2));
  check('1 paste: the pasted image did not insert any text', (await ev(`document.querySelector(${JSON.stringify(TA)}).value`)) === '');
  check('1 count: shows 2/5', (await ev('document.querySelector("#tab-project-chat .attach-count")?.textContent')) === '2/5');
  await shot('images-1-chips-dark');
  await ev('document.body.classList.remove("theme-dark");document.body.classList.add("theme-light")');
  await sleep(300);
  await shot('images-2-chips-light');
  await ev('document.body.classList.remove("theme-light");document.body.classList.add("theme-dark")');

  const text = Buffer.from('plain words').toString('base64');
  check('2 main refuses a text file called .png (by its bytes)', (await stage(`Uint8Array.from(atob(${JSON.stringify(text)}),c=>c.charCodeAt(0)).buffer`)).code === 'type');
  check('2 main refuses an SVG', (await stage(`new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>').buffer`)).code === 'type');
  check('2 main refuses more than 3.5 MB before copying', (await stage('new ArrayBuffer(3.6*1024*1024)')).code === 'too-big');
  check('2 main refuses a forged payload (not bytes)', (await evAsync('window.bar.stageImage("not bytes").then(r=>JSON.stringify(r))')).includes('"ok":false'));
  const six = await pasteImages(['image/png', 'image/png', 'image/png', 'image/png']);
  await until(async () => (await chips()) === 5, 8000);
  check('2 the 6th image is refused with a fixed message (5 chips, "At most 5")', (await chips()) === 5 && /At most 5/.test(await chipError()), await chipError());
  await pasteImages(['image/png']);
  await sleep(500);
  check('2 a further paste adds nothing', (await chips()) === 5);
  await ev('(()=>{const x=document.querySelectorAll("#tab-project-chat .attach-x");for(const b of [x[4],x[3],x[2]]) b.click();})()');
  check('2 removing chips leaves 2', await until(async () => (await chips()) === 2));
  await ev(`(()=>{const f=new DataTransfer();f.items.add(new File(['x'],'a.txt',{type:'text/plain'}));const t=document.querySelector(".composer");t.dispatchEvent(new DragEvent('drop',{dataTransfer:f,bubbles:true,cancelable:true}));})()`);
  await sleep(300);
  check('2 dropping a non-image says why and adds nothing', (await chips()) === 2 && /Only PNG/.test(await chipError()));

  // ----- 3. "/" and summon keep the draft -----
  await type('/alpha look at these');
  await sleep(150);
  await ev(`(()=>{const t=document.querySelector(${JSON.stringify(TA)});t.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));})()`);
  await click('#tab-project-chat .send');
  await sleep(500);
  check('3 a "/" message with images is refused: meta line, draft and chips stay, nothing ran',
    /Images can only go with an ordinary message/.test(await logText()) && (await chips()) === 2 && (await ev(`document.querySelector(${JSON.stringify(TA)}).value`)) === '/alpha look at these' && runs().length === 0);

  // ----- 4. send with text -----
  await type('what are these');
  await sleep(150);
  await click('#tab-project-chat .send');
  check('4 the user message shows both thumbnails and the chips are cleared', await until(async () => (await ev('document.querySelectorAll("#tab-project-chat .msg.user .msg-thumb").length')) === 2) && (await chips()) === 0);
  const expectBlock = `image/png:${pngBytes.length},image/jpeg:${pasted[0]}`;
  check('4 Claude got 2 images with the exact sizes and types (from the bytes), images first, then the text', await until(async () => (await logText()).includes(`got 2 images: ${expectBlock} text=what are these`)) && runs().at(-1) === '2|what are these|iit', `${(await logText()).slice(-160)} | ${runs().at(-1)}`);
  check('4 the run ends and the hero sleeps', await idle());
  check('4 no image data in the argv', !readLines(argsFile).some((l) => /base64|iVBOR/.test(l)));

  // ----- 5. images only, forged and replayed ids -----
  await setFiles([pngFile]);
  await until(async () => (await chips()) === 1);
  await click('#tab-project-chat .send');
  check('5 an image with no text can be sent (no empty text block)', await until(() => runs().length === 2) && runs().at(-1) === '1||i');
  await idle();
  const before = runs().length;
  await evAsync('(async()=>{window.bar.send("forged ids","sonnet",["nope"]);return 1})()');
  check('5 a forged id: the expiry error shows and no run starts', await until(async () => /An attached image expired/.test(await logText())) && runs().length === before && (await ev('!!document.querySelector("#tab-project-chat .stop")')) === false);
  const staged = await evAsync('window.bar.stageImage(new Uint8Array(' + JSON.stringify([...pngBytes]) + ').buffer).then(r=>r.id)');
  await ev(`window.bar.send("first use","sonnet",[${JSON.stringify(staged)}])`);
  check('5 a staged id works once', await until(() => runs().length === before + 1));
  await idle();
  await ev(`window.bar.send("second use","sonnet",[${JSON.stringify(staged)}])`);
  await sleep(1000);
  check('5 the same id again is refused (consumed), no run', (await logText()).split('An attached image expired').length - 1 === 2 && runs().length === before + 1);
  await ev('window.bar.send("six","sonnet",["a","b","c","d","e","f"])');
  await sleep(500);
  check('5 six ids are refused', runs().length === before + 1);

  // ----- 6. the queue -----
  await type('SLOW first');
  await sleep(150);
  await click('#tab-project-chat .send');
  await until(async () => (await awake()));
  await setFiles([pngFile]);
  await until(async () => (await chips()) === 1);
  await type('queued with image');
  await sleep(150);
  await enter();
  check('6 queue: a message with an image waits and the bar shows "+1 img"', await until(() => ev('/\\+1 img/.test(document.querySelector(".queue-bar")?.textContent||"")')) && (await chips()) === 0);
  const runsBefore = runs().length;
  check('6 queue: when the run ends the queued message goes out WITH its image', await until(() => runs().length === runsBefore + 1, 20000) && runs().at(-1) === '1|queued with image|it', runs().at(-1));
  await idle();

  // ----- 7. an agent follow-up -----
  await type('/alpha plain task');
  await sleep(150);
  await ev(`document.querySelector(${JSON.stringify(TA)}).dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}))`);
  await click('#tab-project-chat .send');
  const beforeAgent = runs().length;
  check('7 agent: it runs (no images) and finishes', await until(() => runs().length === beforeAgent + 1) && runs().at(-1) === '0|plain task|t' && await idle());
  await ev('[...document.querySelectorAll(".agent-tab")].find(t=>/^alpha/.test(t.childNodes[0]?.textContent?.trim()||""))?.click()');
  await sleep(400);
  const agentRuns = runs().length;
  await setFiles([pngFile]);
  await until(async () => (await chips()) === 1);
  await type('describe it');
  await sleep(150);
  await click('#tab-project-chat .send');
  check('7 agent: the follow-up shows the thumbnail in the agent log and the agent got the image', await until(async () => (await ev('document.querySelectorAll("#tab-project-chat .msg.user .msg-thumb").length')) === 1) && await until(() => runs().length === agentRuns + 1) && runs().at(-1) === '1|describe it|it', runs().at(-1));
  await idle();
  await ev('document.querySelector(".agent-tab")?.click()');

  // ----- 8. what is saved, and the CSP -----
  const saved = await until(() => {
    try {
      const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      return s.workspaces[0].messages.some((m) => m.kind === 'user' && m.images?.length === 2);
    } catch { return false; }
  }, 16000);
  check('8 settings.json keeps the user message with its two thumbnails', saved);
  const rawSettings = fs.readFileSync(settingsFile, 'utf8');
  const parsed = JSON.parse(rawSettings);
  const imgMsgs = parsed.workspaces[0].messages.filter((m) => m.images);
  check('8 saved thumbnails are small JPEG data URLs (under 6000 chars) and the original is not stored', imgMsgs.length > 0 && imgMsgs.every((m) => m.images.every((i) => /^data:image\/jpeg;base64,/.test(i.thumb) && i.thumb.length <= 6000)) && !rawSettings.includes('iVBORw0KGgo'), `${rawSettings.length} bytes`);
  check('8 settings.json stays small', rawSettings.length < 200_000, `${rawSettings.length}`);
  const csp = await cspOf();
  check('8 CSP allows data: images only (no blob:, no http)', /img-src 'self' data:/.test(csp) && !/blob:/.test(csp) && !/https?:/.test(csp), csp);
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
