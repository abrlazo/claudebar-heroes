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
const modesFile = path.join(work, 'modes.txt');
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
    env: { ...process.env, CLAUDE_BIN: fake, FAKE_NODE: process.execPath, FAKE_ARGS: argsFile, FAKE_RUNS: runsFile, FAKE_RESPONSES: responsesFile, FAKE_MODES: modesFile, ...env }, stdio: 'ignore',
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
const answerRaw = (target, agentId, requestId, decision, message) => evAsync(`window.bar.answerPermission(${JSON.stringify(target)}, ${JSON.stringify(agentId)}, ${JSON.stringify(requestId)}, ${JSON.stringify(decision)}${message === undefined ? '' : `, ${JSON.stringify(message)}`}).then(r=>JSON.stringify(r))`);
const logCount = async (needle) => (await logText()).split(needle).length - 1;
const modeCount = () => readLines(modesFile).length;
const modeAt = (i) => { try { return JSON.parse(readLines(modesFile)[i] ?? 'null')?.request?.mode ?? null; } catch { return null; } };
const metaTexts = () => ev('JSON.stringify([...document.querySelectorAll("#tab-project-chat .msg.meta")].map(m=>m.textContent))').then((j) => JSON.parse(j));
const hasMeta = async (re) => (await metaTexts()).some((t) => re.test(t));
const count = async (re) => (await metaTexts()).filter((t) => re.test(t)).length;
// The newest tab of an agent (they are named "alpha", "alpha 2", ...).
const openNewestAlpha = () => ev(`(()=>{const t=[...document.querySelectorAll(".agent-tab")].filter(x=>/^alpha/.test(x.childNodes[0]?.textContent?.trim()||"")).pop();t?.click();return !!t;})()`);
const lastReply = () => { const m = lastResponse()?.response?.response; return m ?? null; };
const dirs = (...names) => names.map((n) => path.join(project, n));
const cleanDirs = () => { for (const d of dirs('mode-one', 'mode-two', 'perm-allow-dir')) fs.rmSync(d, { recursive: true, force: true }); };
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
  check('1 Quest: ask mode argv = old flags + stream-json input + permission-prompt-tool stdio + the Bypass launch flag',
    /^-p --output-format stream-json --verbose --include-partial-messages --permission-mode default( --resume \S+)?( --model \S+)? --input-format stream-json --permission-prompt-tool stdio --allow-dangerously-skip-permissions$/.test(argvAsk), argvAsk);
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

  // ----- 12. Every project run is a host run, whatever the footer says; the Ask chat keeps its plain argv -----
  await click('#toggle-panel').catch(() => {});
  await sleep(600);
  if (await ev('document.getElementById("panel").classList.contains("hidden")')) await click('#toggle-panel');
  await sleep(600);
  const HOST = '--input-format stream-json --permission-prompt-tool stdio --allow-dangerously-skip-permissions';
  for (const mode of ['acceptEdits', 'bypassPermissions']) {
    await setMode(mode);
    await sleep(300);
    await sendText(`plain ${mode}`);
    await until(async () => (await logText()).includes(`mode=${mode}`), 8000);
    const a = lastArgs();
    check(`12 ${mode}: host argv (stream-json input, permission-prompt-tool, Bypass launch flag), prompt as one JSON line`,
      a.includes(`--permission-mode ${mode}`) && a.endsWith(HOST) && (await logText()).includes('stdin=stream') && (await logText()).includes(`live=${mode}`), a);
    await idle();
  }
  await sendText('/plan plan something');
  await until(async () => (await logText()).includes('mode=plan'), 8000);
  check('12 plan: host argv', lastArgs().includes('--permission-mode plan') && lastArgs().endsWith(HOST), lastArgs());
  await idle();
  const beforeAsk = readLines(argsFile).length;
  await evAsync('window.bar.sendGeneralChat("hello ask", "haiku"), true');
  await until(() => readLines(argsFile).length > beforeAsk, 8000);
  const askArgv = lastArgs();
  check('12 Ask chat: unchanged plain argv (plan mode, no host flags, no Bypass flag), prompt on stdin',
    askArgv.includes('--permission-mode plan') && !askArgv.includes('--input-format') && !askArgv.includes('--permission-prompt-tool') && !askArgv.includes('--allow-dangerously-skip-permissions'), askArgv);
  await sleep(1200);
  await setMode('default');
  await sleep(300);

  // ----- 13. Ask -> Bypass while a card is pending -----
  cleanDirs();
  const modes0 = modeCount();
  const second13 = await logCount('second ran without asking');
  await sendText('PERMMODE one');
  check('13 ask->bypass: a card is pending', await waitCard(1));
  const resp13 = responseCount();
  await setMode('bypassPermissions');
  check('13 ask->bypass: Claude was asked once to switch, with exactly that mode', await until(() => modeCount() === modes0 + 1) && modeAt(modes0) === 'bypassPermissions');
  check('13 ask->bypass: the pending card is allowed for the user and disappears', await waitCard(0, 6000));
  check('13 ask->bypass: Claude got an allow with the stored input', await until(() => responseCount() === resp13 + 1) && lastReply()?.behavior === 'allow' && lastReply()?.updatedInput?.command === 'mkdir mode-one', JSON.stringify(lastResponse()));
  check('13 ask->bypass: the chat says the mode changed and which card was auto-allowed',
    (await hasMeta(/^Permission mode changed to Bypass perms for this run\.$/)) && (await hasMeta(/^Allowed \(Bypass perms\): Bash: mkdir mode-one/)), JSON.stringify(await metaTexts()));
  await shot('perm-mode-switch-line');
  check('13 ask->bypass: the next call runs without any card, and the run ends in bypass',
    await until(async () => (await logCount('second ran without asking')) > second13, 12000) && (await logText()).includes('mode-end=bypassPermissions') && fs.existsSync(dirs('mode-two')[0]) && (await cards()) === 0);
  check('13 ask->bypass: no second switch line and no extra request to Claude', modeCount() === modes0 + 1 && (await count(/^Permission mode changed/)) >= 1);
  await idle();

  // ----- 14. Bypass -> Ask in the work gap: the next call asks -----
  cleanDirs();
  const modes14 = modeCount();
  const first14 = await logCount('perm allowed first');
  await sendText('PERMMODE two');
  check('14 bypass->ask: started in Bypass, the first call is allowed by main without a card',
    await until(async () => (await logCount('perm allowed first')) > first14, 8000) && (await cards()) === 0 && lastArgs().includes('--permission-mode bypassPermissions'), lastArgs());
  await setMode('default');
  check('14 bypass->ask: Claude was asked to switch to default', await until(() => modeCount() === modes14 + 1) && modeAt(modes14) === 'default');
  check('14 bypass->ask: the next call now shows a card', await waitCard(1, 8000));
  check('14 bypass->ask: the chat says so', await hasMeta(/^Permission mode changed to Ask me each time for this run\.$/));
  const end14 = await logCount('mode-end=default');
  await click('.perm-allow');
  check('14 bypass->ask: after Allow the run ends in ask mode', await until(async () => (await logCount('mode-end=default')) > end14, 8000) && fs.existsSync(dirs('mode-two')[0]));
  await idle();

  // ----- 15. One switch reaches the Quest run AND a running agent -----
  cleanDirs();
  const second15 = await logCount('second ran without asking');
  await sendText('PERMMODE quest');
  await waitCard(1);
  await queueText('/alpha PERMMODE agent'); // Enter: an agent start is never queued, even while the Quest run waits
  check('15 both: the agent also waits (badge on its tab)', await until(() => ev('!!document.querySelector(".agent-tab .asking")')), await ev('JSON.stringify([...document.querySelectorAll(".agent-tab")].map(t=>t.innerText))'));
  const modes15 = modeCount();
  await setMode('bypassPermissions');
  check('15 both: each process got exactly one set_permission_mode', await until(() => modeCount() === modes15 + 2, 6000) && modeAt(modes15) === 'bypassPermissions' && modeAt(modes15 + 1) === 'bypassPermissions');
  check('15 both: the Quest card and the agent badge are gone', (await waitCard(0, 6000)) && (await until(() => ev('!document.querySelector(".agent-tab .asking")'))));
  check('15 both: the Quest chat has its line', await hasMeta(/^Permission mode changed to Bypass perms for this run\.$/));
  await openNewestAlpha();
  await sleep(400);
  check('15 both: the agent\'s tab has its own line and its own auto-allow', (await hasMeta(/^Permission mode changed to Bypass perms for this run\.$/)) && (await hasMeta(/^Allowed \(Bypass perms\): Bash/)), JSON.stringify(await metaTexts()));
  await openTab('Quest');
  check('15 both: the Quest run went on without asking', await until(async () => (await logCount('second ran without asking')) > second15, 15000));
  await idle(20000);
  await setMode('default');
  await sleep(300);

  // ----- 16. Accept edits and Plan: calls the mode does not allow are denied at once, with no card -----
  cleanDirs();
  const modes16 = modeCount();
  await sendText('PERMMODE accept');
  check('16 acceptEdits: a card is pending before the switch', await waitCard(1));
  await setMode('acceptEdits');
  check('16 acceptEdits: Claude was asked to switch', await until(() => modeCount() === modes16 + 1) && modeAt(modes16) === 'acceptEdits');
  await sleep(800);
  check('16 acceptEdits: the card that was already waiting stays for the user', (await cards()) === 1);
  const resp16 = responseCount();
  await click('.perm-allow');
  check('16 acceptEdits: after Allow, the next call is denied by main with the fixed text and no card ever shows',
    await until(async () => (await logText()).includes('perm denied second: The current permission mode in Claudebar does not allow'), 10000) && (await cards()) === 0 && responseCount() >= resp16 + 2 && lastReply()?.behavior === 'deny', JSON.stringify(lastResponse()));
  check('16 acceptEdits: nothing was created for the denied call', !fs.existsSync(dirs('mode-two')[0]));
  await idle();
  await setMode('plan');
  await sleep(300);
  cleanDirs();
  const deny16 = await logCount('perm denied first: The current permission mode');
  await sendText('PERMMODE plan');
  check('16 plan: started in plan, both calls denied at once, no card', await until(async () => (await logCount('perm denied first: The current permission mode')) > deny16, 12000) && (await cards()) === 0 && await until(async () => (await logCount('perm denied second: The current permission mode')) >= 2, 12000), lastArgs());
  await idle();
  await setMode('default');
  await sleep(300);

  // ----- 17. The next message, a queued message and a chain step start in the mode of the moment -----
  await sendText('PERMSTALL queue');
  await waitCard(1);
  await queueText('plain queued item');
  await sleep(400);
  await setMode('acceptEdits');
  await sleep(600);
  await click('.perm-deny');
  check('17 queue: the queued message starts after the run, in the mode chosen meanwhile', await until(() => lastArgs().includes('--permission-mode acceptEdits') && !lastArgs().includes('PERMSTALL'), 12000) && (await until(async () => (await logText()).includes('task=plain queued item'), 8000)));
  await idle();
  await setMode('default');
  await sleep(300);
  const chainStart = readLines(argsFile).length;
  await sendText('/alpha PERMSTALL chain && /alpha plain chained');
  check('17 chain: the first step waits', await until(() => ev('!!document.querySelector(".agent-tab .asking")')));
  await setMode('bypassPermissions');
  check('17 chain: the next step starts with the mode set meanwhile (Bypass), as the same agent',
    await until(() => readLines(argsFile).slice(chainStart).some((l) => l.includes('--agent alpha') && l.includes('--permission-mode bypassPermissions') && l.endsWith(HOST) && !l.includes('PERMSTALL')), 15000));
  await idle(20000);
  await setMode('default');
  await sleep(300);

  // ----- 18. Reply -----
  check('18 the panel is open', !(await ev('document.getElementById("panel").classList.contains("hidden")')));
  await sendText('PERMSTALL reply');
  check('18 reply: card', await waitCard(1));
  const labels = await ev('JSON.stringify([...document.querySelectorAll(".perm-actions .perm-btn")].map(b=>b.textContent))');
  check('18 reply: buttons are Deny, Reply..., Allow once (Allow last), no box yet, nothing focused', labels === '["Deny","Reply...","Allow once"]' && (await ev('!document.querySelector(".perm-reply-text")')) && (await ev('!document.activeElement?.classList?.contains("perm-btn")')), labels);
  await click('.perm-replybtn');
  await sleep(200);
  check('18 reply: the box opens, focused (the user clicked), empty text keeps Send disabled',
    await ev('document.activeElement===document.querySelector(".perm-reply-text")') && await ev('document.querySelector(".perm-send").disabled === true'),
    await ev('JSON.stringify({ box: !!document.querySelector(".perm-reply-text"), active: document.activeElement?.tagName + "." + document.activeElement?.className, sendDisabled: document.querySelector(".perm-send")?.disabled })'));
  const key = (k, extra = '') => ev(`(()=>{const t=document.querySelector(".perm-reply-text");t.dispatchEvent(new KeyboardEvent("keydown",{key:${JSON.stringify(k)},bubbles:true,cancelable:true${extra}}));})()`);
  const typeReply = (text) => ev(`(()=>{const t=document.querySelector(".perm-reply-text");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(t,${JSON.stringify(text)});t.dispatchEvent(new Event("input",{bubbles:true}));})()`);
  await typeReply('   ');
  check('18 reply: blank text keeps Send disabled and Enter sends nothing', (await ev('document.querySelector(".perm-send").disabled === true')) && (await (async () => { const n = responseCount(); await key('Enter'); await sleep(300); return responseCount() === n && (await cards()) === 1; })()));
  await typeReply('use the staging folder instead');
  check('18 reply: text enables Send', await ev('document.querySelector(".perm-send").disabled === false'));
  const resp18 = responseCount();
  await key('Escape');
  await sleep(300);
  check('18 reply: Esc closes the box only; nothing is answered and the panel stays open', (await ev('!document.querySelector(".perm-reply-text")')) && (await cards()) === 1 && responseCount() === resp18 && !(await ev('document.getElementById("panel").classList.contains("hidden")')),
    await ev('JSON.stringify({ box: !!document.querySelector(".perm-reply-text"), cards: document.querySelectorAll(".perm-card").length, hidden: document.getElementById("panel").className })') + ` responses ${responseCount()} vs ${resp18}`);
  await click('.perm-replybtn');
  await sleep(200);
  check('18 reply: reopening keeps the typed text', (await ev('document.querySelector(".perm-reply-text").value')) === 'use the staging folder instead');
  await key('Enter', ',isComposing:true');
  await sleep(300);
  check('18 reply: Enter while an IME composes does not send', responseCount() === resp18 && (await cards()) === 1);
  await typeReply('use the staging folder instead, and then run the tests.\nPlease keep the output short. '.repeat(6).trim());
  await sleep(200);
  await shot('perm-reply-box-dark');
  await ev('document.body.classList.remove("theme-dark");document.body.classList.add("theme-light")');
  await sleep(300);
  await shot('perm-reply-box-light');
  await ev('document.body.classList.remove("theme-light");document.body.classList.add("theme-dark")');
  await typeReply('use the staging folder instead');
  await ev('document.querySelector(".perm-reply-text").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",shiftKey:true,bubbles:true,cancelable:true}))');
  await sleep(300);
  check('18 reply: Shift+Enter does not send', responseCount() === resp18 && (await cards()) === 1);
  await key('Enter');
  check('18 reply: Enter sends; the card goes away', await waitCard(0, 6000));
  const r18 = lastReply();
  check('18 reply: Claude got a DENY with the wrapped text, no interrupt, no input',
    r18?.behavior === 'deny' && r18.message === 'The user denied this tool call and replied: "use the staging folder instead". Do what the user replied instead of retrying the denied call.' && !('interrupt' in (lastResponse()?.response?.response ?? {})) && !('updatedInput' in r18), JSON.stringify(lastResponse()));
  check('18 reply: exactly one "You replied to Bash: ..." line, and no user message for it', await until(async () => (await count(/^You replied to Bash: use the staging folder instead$/)) === 1) && !(await ev('[...document.querySelectorAll("#tab-project-chat .msg.user")].some(m=>/staging/.test(m.textContent))')));
  await sleep(800);
  check('18 reply: still exactly one line a moment later (no duplicate)', (await count(/^You replied to/)) === 1);
  await idle();

  // ----- 19. Reply validation in main -----
  await sendText('PERMSTALL forgedreply');
  await waitCard(1);
  const resp19 = responseCount();
  const bad = [
    await answerRaw('quest', null, 'stall-1', 'allow', 'x'),
    await answerRaw('quest', null, 'stall-1', 'allow', ''),
    await answerRaw('quest', null, 'stall-1', 'deny', 'z'.repeat(5000)),
    await answerRaw('quest', null, 'stall-1', 'deny', '  \u0007 ‮ '),
    await answerRaw('quest', null, 'stall-1', 'deny', ''),
    await evAsync('window.bar.answerPermission("quest", null, "stall-1", "deny", 42).then(r=>JSON.stringify(r))'),
    await answerRaw('quest', null, 'other-id', 'deny', 'hello'),
    await answerRaw('agent', 'nobody', 'stall-1', 'deny', 'hello'),
  ];
  await sleep(400);
  check('19 forged: allow with text, over-long, blank, non-string and unknown/wrong-owner replies are all refused', bad.every((b) => b === '{"ok":false}'), bad.join(' '));
  check('19 forged: the card is still pending and Claude saw nothing', (await cards()) === 1 && responseCount() === resp19);
  const noisy = `ab\u0007c‮d${'x'.repeat(2990)}`;
  check('19 forged: a long reply with control characters goes through', (await answerRaw('quest', null, 'stall-1', 'deny', noisy)) === '{"ok":true}');
  await until(() => responseCount() === resp19 + 1);
  const msg19 = lastReply()?.message ?? '';
  const inner = msg19.replace(/^The user denied this tool call and replied: /, '').replace(/\. Do what the user replied instead of retrying the denied call\.$/, '');
  let text19 = '';
  try { text19 = JSON.parse(inner); } catch { /* checked below */ }
  check('19 forged: Claude got at most 2000 clean characters', text19.startsWith('abcd') && text19.length === 2000 && !/[\u0007‮]/.test(text19), `${text19.length}`);
  check('19 forged: a second answer for that id is refused and never reaches Claude', (await answerRaw('quest', null, 'stall-1', 'deny', 'again')) === '{"ok":false}' && (await answerRaw('quest', null, 'stall-1', 'allow')) === '{"ok":false}' && responseCount() === resp19 + 1);
  check('19 forged: the chat line is capped (2000) and logged once', await until(async () => (await count(/^You replied to Bash: abcd/)) === 1) && (await metaTexts()).find((t) => /^You replied to Bash: abcd/.test(t)).length <= 'You replied to Bash: '.length + 2000);
  await idle();

  // ----- 20. A reply in an agent's tab goes only to that agent's process (the Quest run waits at the same time) -----
  await sendText('PERMSTALL questside');
  await waitCard(1);
  await queueText('/alpha PERMSTALL agentside');
  await until(() => ev('!!document.querySelector(".agent-tab .asking")'));
  await openNewestAlpha();
  await sleep(400);
  check('20 agent reply: its card is in its own tab', (await cards()) === 1 && /alpha/.test(await ev('document.querySelector(".perm-head").innerText')));
  const resp20 = responseCount();
  await click('.perm-replybtn');
  await sleep(200);
  await typeReply('agent only please');
  await key('Enter');
  check('20 agent reply: exactly one answer reached Claude, a deny with the agent\'s text', await until(() => responseCount() === resp20 + 1) && /agent only please/.test(lastReply()?.message ?? '') && (await waitCard(0, 5000)));
  check('20 agent reply: logged once in the agent\'s tab', (await count(/^You replied to Bash: agent only please$/)) === 1);
  await openTab('Quest');
  await sleep(400);
  check('20 agent reply: the Quest run is still waiting on its own card, and its log has no reply line', (await cards()) === 1 && (await count(/agent only please/)) === 0);
  await click('.perm-deny');
  await idle(20000);

  check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  // ----- 21. The timeout (its own app start with a short limit; the real limit is 5 minutes) -----
  stopApp();
  await sleep(1200);
  port += 1;
  app = launch({ CBH_PERMISSION_TIMEOUT_MS: '3000' });
  await connect();
  await sleep(1500);
  await click('#toggle-panel');
  await sleep(900);
  await sendText('PERMSTALL timeout');
  check('21 Timeout: card', await waitCard(1));
  const before13 = responseCount();
  check('21 Timeout: it goes away on its own and Claude was told no', (await waitCard(0, 9000)) && (await until(() => responseCount() > before13)) && lastResponse()?.response?.response?.behavior === 'deny' && /No answer/.test(lastResponse()?.response?.response?.message ?? ''), JSON.stringify(lastResponse()));
  check('21 Timeout: a meta line says nothing was answered', await ev('[...document.querySelectorAll(".msg.meta")].some(m=>/^Denied \\(no answer in time\\): Bash/.test(m.textContent))'));
  check('21 Timeout: the run ends and the hero sleeps', await idle());
  check('21 no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  const restart = async (env) => {
    stopApp();
    await sleep(1200);
    port += 1;
    app = launch(env);
    await connect();
    await sleep(1500);
    await click('#toggle-panel');
    await sleep(900);
  };

  // ----- 22. A switch Claude refuses: loosening is a notice, tightening stops the run -----
  await restart({ FAKE_SETMODE_ERROR: '1' });
  await setMode('default');
  await sleep(300);
  const changed22 = await count(/^Permission mode changed/);
  const allowedAuto22 = await count(/^Allowed \(Bypass perms\)/);
  await sendText('PERMSTALL loosenfail');
  check('22 loosen fails: a card is pending', await waitCard(1));
  await setMode('bypassPermissions');
  check('22 loosen fails: the chat says it applies to the next message', await until(() => hasMeta(/^Could not switch this run to Bypass perms; it applies to your next message\.$/)), JSON.stringify(await metaTexts()));
  await sleep(500);
  check('22 loosen fails: the run keeps asking (the card stays, nothing was auto-allowed)', (await cards()) === 1 && (await count(/^Allowed \(Bypass perms\)/)) === allowedAuto22 && (await count(/^Permission mode changed/)) === changed22);
  await click('.perm-deny');
  await idle();
  check('22 loosen fails: the footer still says Bypass and the next message starts in Bypass',
    (await ev('document.getElementById("permission-mode").value')) === 'bypassPermissions');
  cleanDirs();
  const first22 = await logCount('perm allowed first');
  const stopped22 = await logCount('so the run was stopped');
  await sendText('PERMMODE tighten');
  check('22 tighten fails: the run started in Bypass (first call allowed by main)', await until(async () => (await logCount('perm allowed first')) > first22, 8000) && lastArgs().includes('--permission-mode bypassPermissions'), lastArgs());
  await setMode('default');
  check('22 tighten fails: the run is stopped with an explanation', await until(async () => (await logCount('Could not apply Ask me each time to the running Claude, so the run was stopped')) > stopped22, 8000));
  const end22 = await logCount('mode-end=');
  check('22 tighten fails: the run ends, the hero sleeps and the second call never ran', (await idle(10000)) && !fs.existsSync(dirs('mode-two')[0]) && (await logCount('mode-end=')) === end22);
  check('22 no page errors', pageErrors.length === 0, pageErrors.join(' | '));

  // ----- 23. A Claude that never answers set_permission_mode (5 s) -----
  await restart({ FAKE_NO_SETMODE: '1' });
  await setMode('default');
  await sleep(300);
  const claimed23 = await count(/^Permission mode changed|^Could not switch/);
  await sendText('PERMSTALL silent');
  await waitCard(1);
  await setMode('bypassPermissions');
  await sleep(2500);
  check('23 no answer: nothing is claimed before the 5 s are over', (await count(/^Permission mode changed|^Could not switch/)) === claimed23);
  check('23 no answer: after 5 s the chat says it applies to the next message, the card stays', await until(() => hasMeta(/^Could not switch this run to Bypass perms; it applies to your next message\.$/), 7000) && (await cards()) === 1);
  await click('.perm-deny');
  await idle();
  await setMode('default');
  await sleep(300);

  // ----- 24. A Claude that rejects the host flags: the plain argv comes back for the other modes -----
  await restart({ FAKE_REJECT_HOST: '1' });
  await setMode('default');
  await sleep(300);
  await sendText('plain hostless');
  check('24 old Claude: Ask me each time fails with the update hint', await until(() => ev('/update Claude Code/.test(document.querySelector("#tab-project-chat .msg-log")?.innerText || "")'), 8000));
  await idle();
  await setMode('acceptEdits');
  await sleep(300);
  await sendText('plain fallback');
  check('24 old Claude: the other modes start with the old plain argv (no host flags, prompt on stdin)',
    await until(async () => (await logText()).includes('stdin=text'), 8000) && !lastArgs().includes('--input-format') && !lastArgs().includes('--allow-dangerously-skip-permissions') && lastArgs().includes('--permission-mode acceptEdits'), lastArgs());
  await idle();
  await setMode('default');
  check('24 no page errors', pageErrors.length === 0, pageErrors.join(' | '));
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
