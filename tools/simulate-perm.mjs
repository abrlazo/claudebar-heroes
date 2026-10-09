// Focused simulation of the permission prompts ("Ask me each time"): the real app in an isolated user-data folder
// against tools/fake-perm.mjs (a fake `claude` that speaks the protocol captured from the real CLI), driven over
// the Chrome DevTools protocol. Covers allow, deny, agents, Stop, the timeout, forged and repeated answers, two
// pending requests, interactive tools, the other modes' argv, hostile text, delegated-agent labels, closing a tab,
// a window reload and the strip indicator with the panel closed.
//
// Usage: npm run simulate:perm [-- --out <screenshot-dir>]   (builds first). Exit code 1 if a check fails.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = createRequire(import.meta.url)('electron');
const outFlag = process.argv.indexOf('--out');
const outDir = outFlag > -1 ? path.resolve(process.argv[outFlag + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-perm-shots-'));
fs.mkdirSync(outDir, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-permsim-'));
let port = 9400 + Math.floor(Math.random() * 90);

const fake = path.join(work, 'fake-claude.sh');
fs.writeFileSync(fake, `#!/bin/bash\nexec "$FAKE_NODE" "${path.join(root, 'tools', 'fake-perm.mjs')}" "$@"\n`, { mode: 0o755 });
const argsFile = path.join(work, 'args.txt');
const runsFile = path.join(work, 'runs.txt');
const responsesFile = path.join(work, 'responses.txt');
const readLines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);

const project = path.join(work, 'project');
fs.mkdirSync(path.join(project, '.claude', 'agents'), { recursive: true });
fs.writeFileSync(path.join(project, '.claude', 'agents', 'alpha.md'), '---\nname: alpha\ndescription: Simulated alpha agent\n---\n\nYou are alpha.\n');
const userData = path.join(work, 'userData');
fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  permissionMode: 'default', windowPos: null, theme: 'dark', panelHeight: 500, activeId: 'perm-ws',
  workspaces: [{
    id: 'perm-ws', path: project, name: 'permsim', heroSeed: 'perm-seed',
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
    env: { ...process.env, CLAUDE_BIN: fake, FAKE_NODE: process.execPath, FAKE_ARGS: argsFile, FAKE_RUNS: runsFile, FAKE_RESPONSES: responsesFile, ...env }, stdio: 'ignore',
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
const cards = () => ev('document.querySelectorAll(".perm-card").length');
const awake = () => ev('!document.getElementById("hero").classList.contains("sleeping")');
const asleep = async () => !(await awake());
const logText = () => ev('document.querySelector("#tab-project-chat .msg-log")?.innerText || ""');
const setMode = (v) => ev(`(()=>{const s=document.getElementById("permission-mode");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s,${JSON.stringify(v)});s.dispatchEvent(new Event("change",{bubbles:true}));})()`);
const openTab = (name) => ev(`[...document.querySelectorAll(".agent-tab")].find(t=>t.childNodes[0]?.textContent?.trim()===${JSON.stringify(name)})?.click()`);
const waitCard = (n = 1, ms = 10000) => until(async () => (await cards()) === n, ms);
const lastArgs = () => readLines(argsFile).at(-1) ?? '';
const responseCount = () => readLines(responsesFile).length;
const lastResponse = () => { try { return JSON.parse(readLines(responsesFile).at(-1) ?? 'null'); } catch { return null; } };
const answerRaw = (target, agentId, requestId, decision) => evAsync(`window.bar.answerPermission(${JSON.stringify(target)}, ${JSON.stringify(agentId)}, ${JSON.stringify(requestId)}, ${JSON.stringify(decision)}).then(r=>JSON.stringify(r))`);
const idle = (ms = 15000) => until(asleep, ms);

try {
  app = launch({});
  await connect();
  await sleep(1500);
  await click('#toggle-panel');
  await sleep(900);
  await ev('globalThis.__cbhIdleMs = 3600000');
  const dir = path.join(project, 'perm-allow-dir');

  // ----- 1. Quest, allow (and the panel-closed indicator) -----
  await sendText('PERMALLOW first');
  check('1 Quest: a card appears while Claude waits', await waitCard(1));
  const head = await ev('document.querySelector(".perm-head")?.innerText || ""');
  const detail = await ev('document.querySelector(".perm-detail")?.innerText || ""');
  check('1 Quest: it names Quest, the tool and shows the command', /Quest/.test(head) && /Bash/.test(head) && detail.includes('mkdir perm-allow-dir'), `${head} | ${detail}`);
  check('1 Quest: the run is still busy and the hero awake', (await awake()) && (await ev('!!document.querySelector("#tab-project-chat .stop")')));
  check('1 Quest: no button has focus (Enter cannot approve)', await ev('!document.activeElement?.classList?.contains("perm-btn")'));
  const argvAsk = lastArgs();
  check('1 Quest: ask mode argv = old flags + stream-json input + permission-prompt-tool stdio',
    /^-p --output-format stream-json --verbose --include-partial-messages --permission-mode default( --resume \S+)?( --model \S+)? --input-format stream-json --permission-prompt-tool stdio$/.test(argvAsk), argvAsk);
  await shot('perm-1-card-dark');
  await ev('document.body.classList.remove("theme-dark");document.body.classList.add("theme-light")');
  await sleep(300);
  await shot('perm-2-card-light');
  await ev('document.body.classList.remove("theme-light");document.body.classList.add("theme-dark")');
  // The panel closed: the strip is all the user sees.
  await click('#toggle-panel');
  await sleep(700);
  const closed = await ev('JSON.stringify({ pending: document.body.classList.contains("perm-pending"), status: document.getElementById("status").textContent, anim: getComputedStyle(document.getElementById("strip")).animationName })');
  check('1 Quest: with the panel closed the strip pulses and the HUD says it waits', /"pending":true/.test(closed) && /Waiting for your OK \(1\)/.test(closed) && /perm-pulse/.test(closed), closed);
  await shot('perm-5-strip-panel-closed');
  await click('#toggle-panel');
  await sleep(600);
  check('1 Quest: the card is still there after reopening the panel', (await cards()) === 1);
  const before1 = responseCount();
  await click('.perm-allow');
  check('1 Quest: Allow once removes the card', await waitCard(0));
  check('1 Quest: Claude got exactly one allow with the stored input', responseCount() === before1 + 1 && lastResponse()?.response?.response?.behavior === 'allow' && lastResponse()?.response?.response?.updatedInput?.command === 'mkdir perm-allow-dir', JSON.stringify(lastResponse()));
  check('1 Quest: the command really ran and the log says so', await until(async () => fs.existsSync(dir) && (await logText()).includes('perm allowed one')), (await logText()).slice(-200));
  check('1 Quest: the decision is a meta line (not a user message)', await ev('[...document.querySelectorAll(".msg.meta")].some(m=>/^Allowed: Bash: mkdir perm-allow-dir/.test(m.textContent))'));
  check('1 Quest: the run ends and the hero sleeps; the indicator is gone', (await idle()) && !(await ev('document.body.classList.contains("perm-pending")')));

  // ----- 2. Quest, deny -----
  fs.rmSync(dir, { recursive: true, force: true });
  await sendText('PERMALLOW second');
  check('2 Quest deny: card', await waitCard(1));
  await click('.perm-deny');
  check('2 Quest deny: card removed, Claude told no', (await waitCard(0)) && lastResponse()?.response?.response?.behavior === 'deny');
  check('2 Quest deny: nothing ran, the run continued and ended', await until(async () => (await logText()).includes('perm denied one')) && !fs.existsSync(dir) && (await idle()));
  check('2 Quest deny: a meta line says Denied', await ev('[...document.querySelectorAll(".msg.meta")].some(m=>/^Denied: Bash: mkdir perm-allow-dir/.test(m.textContent))'));

  // ----- 3. an agent's request shows in its own tab -----
  await sendText('/alpha PERMALLOW agent');
  check('3 Agent: the agent tab shows a badge', await until(() => ev('!!document.querySelector(".agent-tab .asking")')));
  check('3 Agent: no card in the Quest tab', (await cards()) === 0);
  const tabBadge = await ev('document.querySelector(".agent-tab .asking")?.parentElement?.innerText || ""');
  check('3 Agent: the HUD and wisp show it waits', /alpha/.test(tabBadge) && /Waiting for your OK/.test(await ev('document.getElementById("status").textContent')) && (await ev('!!document.querySelector(".minion.asking")')));
  await openTab('alpha');
  await sleep(300);
  check('3 Agent: its card is in its own tab, labelled with the agent', (await cards()) === 1 && /alpha/.test(await ev('document.querySelector(".perm-head").innerText')));
  fs.rmSync(dir, { recursive: true, force: true });
  await click('.perm-allow');
  check('3 Agent: Allow works and the agent finishes', (await waitCard(0)) && (await until(() => ev('document.querySelector(".agent-tab.active .status")?.textContent==="done"'))) && fs.existsSync(dir));
  check('3 Agent: the decision is logged in the agent\'s tab', await ev('[...document.querySelectorAll("#tab-project-chat .msg.meta")].some(m=>/^Allowed: Bash/.test(m.textContent))'));
  await openTab('Quest');

  // ----- 4. Stop denies what is pending and pauses the queue -----
  await sendText('PERMSTALL stop');
  check('4 Stop: card', await waitCard(1));
  await queueText('queued while waiting');
  await sleep(500);
  const before4 = responseCount();
  await click('#tab-project-chat .stop');
  check('4 Stop: the card disappears and main told Claude no before stopping it', (await waitCard(0, 8000)) && (await until(() => readLines(responsesFile).slice(before4).some((l) => l.includes('"behavior":"deny"') && l.includes('was stopped')))));
  check('4 Stop: the run ends and the hero sleeps', await idle());
  check('4 Stop: the queue paused with the message kept', await until(() => ev('/Queue paused/.test(document.querySelector(".queue-bar")?.innerText || "")')) && (await ev('document.querySelectorAll(".queue-item").length')) === 1);
  await click('.queue-clear');

  // ----- 5. Forged, wrong-owner and repeated answers -----
  await sendText('PERMSTALL forged');
  check('5 Forged: card', await waitCard(1));
  const before5 = responseCount();
  const forged = [
    await answerRaw('quest', null, 'forged-id', 'allow'),
    await answerRaw('agent', 'nobody', 'stall-1', 'allow'),
    await answerRaw('quest', null, 'stall-1', 'maybe'),
    await answerRaw('nowhere', null, 'stall-1', 'allow'),
  ];
  await sleep(500);
  check('5 Forged: unknown id, wrong owner, bad decision and bad target are refused', forged.every((f) => f === '{"ok":false}'), forged.join(' '));
  check('5 Forged: the card is still there and Claude saw nothing', (await cards()) === 1 && responseCount() === before5);
  await click('.perm-deny');
  check('5 Forged: the real answer goes through once', (await waitCard(0)) && (await until(() => responseCount() === before5 + 1)));
  check('5 Forged: a second answer for the same id is refused and never reaches Claude', (await answerRaw('quest', null, 'stall-1', 'allow')) === '{"ok":false}' && responseCount() === before5 + 1);
  await idle();

  // ----- 6. Two pending requests -----
  await sendText('PERMTWO both');
  check('6 Two: first card says "1 of 2"', (await waitCard(1)) && (await ev('document.querySelector(".perm-count")?.textContent')) === '1 of 2');
  await shot('perm-4-two-pending');
  await click('.perm-allow');
  check('6 Two: the second request follows after the first is answered', await until(async () => (await cards()) === 1 && (await ev('!document.querySelector(".perm-count")')) && /two-b\.txt/.test(await ev('document.querySelector(".perm-path")?.innerText || ""'))));
  await click('.perm-deny');
  check('6 Two: both answers reached Claude in order (allow, deny)', await until(async () => (await logText()).includes('first allowed') && (await logText()).includes('second denied')));
  await idle();

  // ----- 7. Interactive tools never show a card -----
  const before7 = responseCount();
  await sendText('PERMASKQ now');
  await sleep(2500);
  check('7 Interactive: no card was ever shown', (await cards()) === 0);
  check('7 Interactive: it was denied in main with the fixed message and the run went on', await until(async () => (await logText()).includes('asked in plain text instead')) && responseCount() === before7 + 1 && /cannot show/.test(lastResponse()?.response?.response?.message ?? ''), JSON.stringify(lastResponse()));
  await idle();

  // ----- 8. Hostile text -----
  await sendText('PERMBIG hostile');
  check('8 Safety: the card appears', await waitCard(1));
  const safety = await ev(`(()=>{const c=document.querySelector(".perm-card"),d=c.querySelector(".perm-detail"),p=document.getElementById("panel").getBoundingClientRect();
    return JSON.stringify({ imgs:c.querySelectorAll("img,b,script").length, pwned:typeof window.__pwned, text:d.innerText, scrolls:d.scrollHeight>d.clientHeight, h:c.getBoundingClientRect().height, ph:p.height, wide:c.scrollWidth>c.clientWidth+1||d.scrollWidth>d.clientWidth+1, more:c.querySelector(".perm-more")?.innerText||"", bidi:/[\\u202a-\\u202e\\u2066-\\u2069\\u0007]/.test(c.innerText) });})()`);
  const s8 = JSON.parse(safety);
  check('8 Safety: markup is plain text (no img/b element, nothing executed)', s8.imgs === 0 && s8.pwned === 'undefined' && s8.text.includes('<img src=x'), JSON.stringify({ imgs: s8.imgs, pwned: s8.pwned }));
  check('8 Safety: control and bidi characters are gone', !s8.bidi);
  check('8 Safety: the card height is bounded, the block scrolls, nothing overflows sideways', s8.h <= s8.ph * 0.45 && s8.scrolls && !s8.wide, `${s8.h} of ${s8.ph}`);
  check('8 Safety: a marker says there is more', /more line|more text/.test(s8.more), s8.more);
  await shot('perm-3-long-command');
  await click('.perm-deny');
  await idle();

  // ----- 9. A delegated agent's request is labelled -----
  await sendText('PERMSUB delegated');
  check('9 Delegated: the card says it comes via a delegated agent', (await waitCard(1)) && /via a delegated agent/.test(await ev('document.querySelector(".perm-head").innerText')));
  await click('.perm-deny');
  await idle();

  // ----- 10. Closing an agent's tab with a pending request -----
  await sendText('/alpha PERMSTALL close');
  await until(() => ev('!!document.querySelector(".agent-tab .asking")'));
  const before10 = responseCount();
  await ev('[...document.querySelectorAll(".agent-tab")].find(t=>/alpha 2/.test(t.innerText))?.querySelector(".close")?.click()');
  check('10 Close: the agent is stopped, Claude told no, nothing waits any more', await until(async () => responseCount() > before10 && !(await ev('document.body.classList.contains("perm-pending")'))));
  await idle();

  // ----- 11. A window reload with a request pending -----
  await sendText('PERMSTALL reload');
  await waitCard(1);
  const before11 = responseCount();
  await send('Page.reload');
  check('11 Reload: main denies what nobody can answer any more', await until(() => responseCount() > before11, 8000) && lastResponse()?.response?.response?.behavior === 'deny');
  await sleep(1500);
  check('11 Reload: no card is left', (await cards()) === 0);

  // ----- 12. The other modes keep their old argv -----
  await click('#toggle-panel').catch(() => {});
  await sleep(600);
  if (await ev('document.getElementById("panel").classList.contains("hidden")')) await click('#toggle-panel');
  await sleep(600);
  const oldArgs = { acceptEdits: '--permission-mode acceptEdits', bypassPermissions: '--permission-mode bypassPermissions' };
  for (const [mode, expected] of Object.entries(oldArgs)) {
    await setMode(mode);
    await sleep(300);
    await sendText(`plain ${mode}`);
    await until(async () => (await logText()).includes(`mode=${mode}`), 8000);
    const a = lastArgs();
    check(`12 ${mode}: plain argv (no stream-json input, no permission-prompt-tool), prompt on stdin`, a.includes(expected) && !a.includes('--input-format') && !a.includes('--permission-prompt-tool') && (await logText()).includes('stdin=text'), a);
    await idle();
  }
  await sendText('/plan plan something');
  await until(async () => (await logText()).includes('mode=plan'), 8000);
  check('12 plan: plain argv', lastArgs().includes('--permission-mode plan') && !lastArgs().includes('--input-format') && !lastArgs().includes('--permission-prompt-tool'), lastArgs());
  await idle();
  await setMode('default');
  await sleep(300);

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  // ----- 13. The timeout (its own app start with a short limit; the real limit is 5 minutes) -----
  stopApp();
  await sleep(1200);
  port += 1;
  app = launch({ CBH_PERMISSION_TIMEOUT_MS: '3000' });
  await connect();
  await sleep(1500);
  await click('#toggle-panel');
  await sleep(900);
  await sendText('PERMSTALL timeout');
  check('13 Timeout: card', await waitCard(1));
  const before13 = responseCount();
  check('13 Timeout: it goes away on its own and Claude was told no', (await waitCard(0, 9000)) && (await until(() => responseCount() > before13)) && lastResponse()?.response?.response?.behavior === 'deny' && /No answer/.test(lastResponse()?.response?.response?.message ?? ''), JSON.stringify(lastResponse()));
  check('13 Timeout: a meta line says nothing was answered', await ev('[...document.querySelectorAll(".msg.meta")].some(m=>/^Denied \\(no answer in time\\): Bash/.test(m.textContent))'));
  check('13 Timeout: the run ends and the hero sleeps', await idle());
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
