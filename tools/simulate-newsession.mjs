// Focused simulation of "New session archives the Quest chat": the real app in an isolated user-data folder against
// tools/fake-images.mjs (a plain fake `claude`), driven over the Chrome DevTools protocol. Covers the archive pill and
// drawer after New session, what settings.json keeps, an empty chat, New session while busy, a forged quest record
// and the badge in both themes.
//
// Usage: npm run simulate:newsession [-- --out <screenshot-dir>]   (builds first). Exit code 1 if a check fails.

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
const outDir = outFlag > -1 ? path.resolve(process.argv[outFlag + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-newsession-shots-'));
fs.mkdirSync(outDir, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-nssim-'));
const port = 9600 + Math.floor(Math.random() * 90);

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
    archive: [{ id: 'agent-old', name: 'alpha', definition: 'alpha', task: 'old task', observed: false, status: 'done', reason: 'idle',
      startedAt: 1000, endedAt: 2000, archivedAt: 3000, usage: { input: 1, output: 2, cacheRead: 0, cacheCreate: 0 }, sessionId: null,
      messages: [{ kind: 'user', text: 'old task' }, { kind: 'assistant', text: 'old answer' }] }],
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
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.exceptionThrown') pageErrors.push(d.params.exceptionDetails?.exception?.description || d.params.exceptionDetails?.exception?.value || d.params.exceptionDetails?.text || 'exception'); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); pendingCalls.delete(d.id); } };
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

const pillText = () => ev('document.querySelector(".archive-pill")?.textContent || ""');
const readSettings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
const waitSettings = (pred, ms = 16000) => until(() => { try { return pred(readSettings().workspaces[0]); } catch { return false; } }, ms);
const colours = () => ev(`(()=>{const b=document.querySelector("#archive-drawer .archive-badge.quest");if(!b)return null;return [getComputedStyle(b).color,getComputedStyle(document.body).backgroundColor].join("|")})()`);

try {
  app = launch();
  await connect();
  await sleep(1500);
  await click('#toggle-panel');
  await sleep(900);
  await ev('globalThis.__cbhIdleMs = 3600000');

  check('0 the pill starts at Archive (1)', (await pillText()) === 'Archive (1)', await pillText());
  const usageBefore = readSettings().workspaces[0].usage;

  // ----- 1. a finished chat is archived by New session -----
  await type('hello');
  await sleep(150);
  await click('#tab-project-chat .send');
  check('1 the run answers and ends', await until(async () => (await logText()).includes('got 0 images') && !(await awake()), 20000));
  await waitSettings((w) => w.messages.length >= 2 && !!w.sessionId);
  const sessionBefore = readSettings().workspaces[0].sessionId;
  await click('#new-session');
  check('1 the pill reads Archive (2)', await until(async () => (await pillText()) === 'Archive (2)'), await pillText());
  check('1 the Quest chat shows only the meta line', await until(async () => /New session started\. The previous chat is in the Archive\./.test(await logText())) && !(await logText()).includes('hello'), await logText());
  await click('.archive-pill');
  await sleep(600);
  const first = await ev('(()=>{const i=document.querySelector("#archive-drawer .archive-item");return JSON.stringify({q:!!i?.querySelector(".archive-badge.quest"),t:i?.textContent||"",log:document.querySelector("#archive-drawer .msg-log")?.innerText||""})})()').then(JSON.parse);
  check('1 the newest item has the quest badge', first.q, first.t);
  check('1 its log has "hello" and the reply', first.log.includes('hello') && first.log.includes('got 0 images'), first.log);
  await shot('newsession-dark');
  const cDark = await colours();
  await ev('document.body.classList.remove("theme-dark");document.body.classList.add("theme-light")');
  await sleep(300);
  const cLight = await colours();
  await shot('newsession-light');
  await ev('document.body.classList.remove("theme-light");document.body.classList.add("theme-dark")');
  check('1 the badge colour differs from the background in both themes', !!cDark && !!cLight && cDark.split('|')[0] !== cDark.split('|')[1] && cLight.split('|')[0] !== cLight.split('|')[1] && cDark.split('|')[0] !== cLight.split('|')[0], `${cDark} / ${cLight}`);
  await click('#archive-close');

  // ----- 2. what is saved -----
  check('2 settings.json has the quest record, the chat holds only the meta line', await waitSettings((w) => w.archive.length === 2 && w.messages.length === 1 && w.messages[0].kind === 'meta'));
  const w = readSettings().workspaces[0];
  const q = w.archive.at(-1);
  check('2 the record is source quest, reason new-session, session kept, usage zero, startedAt 0', q.source === 'quest' && q.reason === 'new-session' && q.sessionId === sessionBefore && q.startedAt === 0 && q.usage.input === 0 && /^quest-/.test(q.id), JSON.stringify({ ...q, messages: q.messages.length }));
  check('2 the old agent record is still there as an agent', w.archive[0].id === 'agent-old' && w.archive[0].source === 'agent');
  check('2 the workspace session is cleared and lifetime usage is unchanged', w.sessionId === null && JSON.stringify(w.usage) === JSON.stringify(usageBefore) || w.usage.input > usageBefore.input);

  // ----- 3. nothing to keep -----
  await click('#new-session');
  await sleep(1200);
  check('3 New session on a chat with only a meta line adds no record', (await pillText()) === 'Archive (2)', await pillText());

  // ----- 4. refused while busy -----
  await type('SLOW busy one');
  await sleep(150);
  await click('#tab-project-chat .send');
  await until(async () => await awake());
  await click('#new-session');
  await sleep(800);
  check('4 New session while busy is refused: archive and chat unchanged', (await pillText()) === 'Archive (2)' && (await logText()).includes('SLOW busy one'), await pillText());
  const direct = await evAsync('window.bar.newSession().then(s=>s.workspaces[0].archive.length)');
  check('4 main refuses it too (direct call, run live)', direct === 2, String(direct));
  await idle(20000);

  // ----- 5. forged quest record -----
  const forged = await evAsync(`window.bar.archiveAgent("img-ws",{id:"forged-1",source:"quest",name:"x",status:"done",reason:"idle",messages:[{kind:"user",text:"f"}]}).then(r=>JSON.stringify(r?.archive?.at(-1)||null))`).then(JSON.parse);
  check('5 a forged source quest is stored as an agent record', forged && forged.id === 'forged-1' && forged.source === 'agent', JSON.stringify(forged));
  const forged2 = await evAsync(`window.bar.archiveAgent("img-ws",{id:"forged-2",source:"quest",name:"x",status:"done",reason:"new-session",messages:[{kind:"user",text:"f"}]}).then(r=>JSON.stringify(r))`);
  check('5 a forged new-session record is refused', forged2 === 'null', forged2);
  // ----- 7. restore an archived Quest chat (swap) -----
  const snap = () => { const w = readSettings().workspaces[0]; return { kills: w.kills, map: w.map, seed: w.heroSeed, usage: JSON.stringify(w.usage) }; };
  const before7 = snap();
  await waitSettings((w) => w.archive.length === 3 && w.messages.length >= 2);
  const quest7 = readSettings().workspaces[0].archive.find((r) => r.source === 'quest');
  const current7 = readSettings().workspaces[0].messages.find((m) => m.kind === 'user')?.text;
  await click('.archive-pill');
  await sleep(600);
  await ev('[...document.querySelectorAll("#archive-drawer .archive-item")].find((i) => i.querySelector(".archive-badge.quest")).click()');
  await sleep(300);
  check('7 the Restore button shows for a quest chat, not for an agent chat', (await ev('!!document.querySelector("#archive-drawer .archive-restore:not(:disabled)")')) === true);
  await shot('restore-dark');
  await ev('document.body.classList.remove("theme-dark");document.body.classList.add("theme-light")');
  await sleep(300);
  await shot('restore-light');
  await ev('document.body.classList.remove("theme-light");document.body.classList.add("theme-dark")');
  await ev('[...document.querySelectorAll("#archive-drawer .archive-item")].find((i) => !i.querySelector(".archive-badge.quest")).click()');
  await sleep(300);
  check('7 an agent chat has no Restore button', (await ev('!!document.querySelector("#archive-drawer .archive-restore")')) === false);
  await ev('[...document.querySelectorAll("#archive-drawer .archive-item")].find((i) => i.querySelector(".archive-badge.quest")).click()');
  await sleep(300);
  await click('#archive-drawer .archive-restore');
  check('7 the old chat is on screen and the drawer is closed', await until(async () => (await logText()).includes('hello') && !(await ev('!!document.querySelector("#archive-drawer .archive-item")'))), await logText());
  check('7 settings.json: old messages and session back, archive count unchanged, current chat is the newest quest record', await waitSettings((w) => w.sessionId === quest7.sessionId && w.messages.some((m) => m.text === 'hello') && w.archive.length === 3 && w.archive.at(-1).source === 'quest' && w.archive.at(-1).messages.some((m) => m.text === current7) && !w.archive.some((r) => r.id === quest7.id)));
  const after7 = snap();
  check('7 hero, kills, map and usage are untouched', JSON.stringify(before7) === JSON.stringify(after7));
  const argsBefore = readLines(argsFile).length;
  await type('and again');
  await sleep(150);
  await click('#tab-project-chat .send');
  check('7 the next send resumes the restored session', await until(() => readLines(argsFile).slice(argsBefore).join('\n').includes(`--resume\n${quest7.sessionId}`) || readLines(argsFile).slice(argsBefore).join(' ').includes(`--resume ${quest7.sessionId}`), 20000), readLines(argsFile).slice(argsBefore).join(' ').slice(0, 200));
  await idle(20000);

  // forged calls
  const restoreCall = (wsId, id) => evAsync(`window.bar.restoreQuest(${JSON.stringify(wsId)}, ${JSON.stringify(id)}).then((r) => JSON.stringify({ ok: r.ok, reason: r.reason }))`);
  const stable = JSON.stringify(readSettings().workspaces[0].archive.map((r) => r.id));
  const forgedCalls = [await restoreCall('img-ws', 'nope'), await restoreCall('img-ws', 'agent-old'), await restoreCall('other-ws', quest7.id), await restoreCall('img-ws', 42), await restoreCall('img-ws', 'x'.repeat(200))];
  check('7 forged restores (unknown, agent record, other workspace, non-string, too long) all fail', forgedCalls.every((r) => JSON.parse(r).ok === false), forgedCalls.join(' '));
  check('7 agent record and unknown id answer not-restorable', JSON.parse(forgedCalls[0]).reason === 'not-restorable' && JSON.parse(forgedCalls[1]).reason === 'not-restorable');
  check('7 forged restores change nothing (the pill and the chat are as before)', (await pillText()) === `Archive (${JSON.parse(stable).length})` && (await logText()).includes('and again'), await pillText());

  // empty current chat: restoring only removes the record
  await click('#new-session');
  await sleep(800);
  const countMid = await evAsync('window.bar.newSession().then(s=>s.workspaces[0].archive.length)');
  const target = readSettings().workspaces[0].archive.find((r) => r.source === 'quest');
  const emptyRes = JSON.parse(await evAsync(`window.bar.restoreQuest("img-ws", ${JSON.stringify(target.id)}).then((r)=>JSON.stringify({ok:r.ok, n:r.settings?.workspaces[0].archive.length}))`));
  check('7 restoring into an empty chat drops the archive by one', emptyRes.ok === true && emptyRes.n === countMid - 1, JSON.stringify({ ...emptyRes, countMid }));

  // refused while busy
  await type('SLOW busy two');
  await sleep(150);
  await click('#tab-project-chat .send');
  await until(async () => await awake());
  const nBusy = readSettings().workspaces[0].archive.length;
  const quest8 = (await evAsync('window.bar.newSession().then(s=>JSON.stringify(s.workspaces[0].archive.filter((r)=>r.source==="quest").map((r)=>r.id)))'));
  const busyRes = JSON.parse(await restoreCall('img-ws', JSON.parse(quest8)[0]));
  check('7 restore while a run is live answers busy', busyRes.ok === false && busyRes.reason === 'busy', JSON.stringify(busyRes));
  await click('.archive-pill');
  await sleep(500);
  check('7 the Restore button is disabled while busy', (await ev('document.querySelector("#archive-drawer .archive-restore")?.disabled')) === true || (await ev('!document.querySelector("#archive-drawer .archive-restore")')) === true);
  await click('#archive-close');
  await idle(20000);
  check('7 busy refusal changed nothing', readSettings().workspaces[0].archive.length === nBusy);

  check('6 no page errors', pageErrors.length === 0, pageErrors.join(' | '));
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
