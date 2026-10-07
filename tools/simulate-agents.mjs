// Simulates multiple agents against the built app without calling the real
// Claude. A fake `claude` (CLAUDE_BIN) streams tool calls and text, the app
// runs in an isolated user-data folder, and the script drives it over the
// Chrome DevTools protocol and checks what is on screen.
//
// Usage: npm run simulate [-- --out <screenshot-dir>]
// Needs a build first (`npm run simulate` does it). Exit code 1 if a check fails.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = createRequire(import.meta.url)('electron');
const outFlag = process.argv.indexOf('--out');
const outDir = outFlag > -1 ? path.resolve(process.argv[outFlag + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-sim-shots-'));
fs.mkdirSync(outDir, { recursive: true });

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-sim-'));
const port = 9300 + Math.floor(Math.random() * 90);

// ----- fake claude -----
const fake = path.join(work, 'fake-claude.sh');
fs.writeFileSync(fake, `#!/bin/bash
resume="none"
while [ $# -gt 0 ]; do if [ "$1" = "--resume" ]; then resume="$2"; fi; shift; done
prompt=$(cat)
sid="sim-$RANDOM"
dur=$(( (RANDOM % 5) + 6 ))
printf '%s\\n' "{\\"type\\":\\"system\\",\\"subtype\\":\\"init\\",\\"session_id\\":\\"$sid\\",\\"model\\":\\"fake\\"}"
sleep 1
for tool in Read Grep Edit; do
  printf '%s\\n' "{\\"type\\":\\"assistant\\",\\"message\\":{\\"content\\":[{\\"type\\":\\"tool_use\\",\\"name\\":\\"$tool\\",\\"input\\":{\\"file_path\\":\\"/repo/$tool.ts\\"}}]}}"
  sleep $(( dur / 3 ))
done
printf '%s\\n' "{\\"type\\":\\"stream_event\\",\\"event\\":{\\"type\\":\\"content_block_delta\\",\\"delta\\":{\\"type\\":\\"text_delta\\",\\"text\\":\\"done (resume=$resume)\\"}}}"
printf '%s\\n' "{\\"type\\":\\"result\\",\\"is_error\\":false,\\"session_id\\":\\"$sid\\",\\"total_cost_usd\\":0.002,\\"num_turns\\":3,\\"duration_ms\\":\${dur}000}"
`, { mode: 0o755 });

// ----- isolated settings: one project, no real data touched -----
const userData = path.join(work, 'userData');
fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  permissionMode: 'default', windowPos: null, theme: 'dark', panelHeight: 500, activeId: 'sim-ws',
  workspaces: [{
    id: 'sim-ws', path: root, name: 'simulation', heroSeed: 'simulation-seed',
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }, lastContext: 0, contextWindow: 200000,
    kills: 0, map: 'forest', sessionId: null, messages: [], agents: [],
  }],
}));

const app = spawn(electronBin, [root, `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], {
  env: { ...process.env, CLAUDE_BIN: fake }, stdio: 'ignore',
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };
let send; let ws;

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
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  await new Promise((r) => { ws.onopen = r; });
  send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable');
}
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value;
const shot = async (name) => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(s.result.data, 'base64'));
};
const type = (selector, text) => ev(`(()=>{const t=document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(text)});
  t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
const click = (selector) => ev(`document.querySelector(${JSON.stringify(selector)}).click()`);
const allDone = () => ev('(()=>{const s=[...document.querySelectorAll(".agent-tab .status")];return s.length>0&&s.every(x=>x.textContent==="done")})()');

try {
  await connect();
  await sleep(1500);
  await click('#toggle-panel');
  await sleep(900);

  const prompt = `run agent ${'investigate the repository structure and report back in detail, '.repeat(5)}`;
  await type('#tab-project-chat textarea', prompt);
  await sleep(150);
  await click('#tab-project-chat .send');
  await sleep(3500);
  await shot('1-agents-running');

  const tabs = await ev('document.querySelectorAll(".agent-tab").length');
  check('three agents spawned (plus the Expedition tab)', tabs === 4, `${tabs} tabs`);
  const labels = await ev('JSON.stringify([document.querySelector(".panel-tabs .tab")?.textContent, document.querySelector(".agent-tab")?.textContent])');
  check('the project chat is labelled Expedition', labels === JSON.stringify(['Expedition', 'Expedition']), labels);

  const boxes = JSON.parse(await ev('JSON.stringify([...document.querySelectorAll(".minion")].map(m=>{const r=m.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}}))'));
  const stage = JSON.parse(await ev('JSON.stringify((()=>{const r=document.getElementById("stage").getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}})())'));
  check('three minions on screen', boxes.length === 3, `${boxes.length}`);
  const inside = boxes.every((b) => b.x >= stage.x - 1 && b.y >= stage.y - 1 && b.x + b.w <= stage.x + stage.w + 1 && b.y + b.h <= stage.y + stage.h + 1);
  check('minions are fully inside the stage (none clipped)', inside);
  let overlap = false;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    if (Math.abs(boxes[i].x - boxes[j].x) < boxes[i].w && Math.abs(boxes[i].y - boxes[j].y) < boxes[i].h) overlap = true;
  }
  check('minions do not overlap each other', !overlap);

  check('the hero is awake while agents work', !(await ev('document.getElementById("hero").classList.contains("sleeping")')));
  const status = await ev('document.getElementById("status").textContent');
  check('HUD status reflects agent work', /agent/i.test(status), status);

  await sleep(1500);
  const names = await ev('[...document.querySelectorAll(".enemy-name")].map(e=>e.textContent).join(",")');
  check('agent tool calls send named monsters', /Read|Grep|Edit/.test(names), names || 'none yet');

  await click('.agent-tab:nth-child(3)');
  await sleep(300);
  const agentLog = await ev('[...document.querySelectorAll("#tab-project-chat .msg")].map(m=>m.textContent).join(" ")');
  check("an agent's tab shows its own log", /Read/.test(agentLog), agentLog.slice(0, 60));

  for (let i = 0; i < 40 && !(await allDone()); i++) await sleep(500);
  check('all agents finish', await allDone());
  await sleep(3200); // victory pose, then the hero lies down
  check('the hero falls asleep after the agents finish', await ev('document.getElementById("hero").classList.contains("sleeping")'));
  await shot('2-agents-done');

  await type('#tab-project-chat textarea', 'please elaborate');
  await sleep(150);
  await click('#tab-project-chat .send');
  await sleep(300);
  const active = await ev('document.querySelector(".agent-tab.active")?.textContent||""');
  check('messaging an agent keeps its tab selected', /Agent 2/.test(active), active);
  for (let i = 0; i < 40 && !(await allDone()); i++) await sleep(500);
  const reply = await ev('[...document.querySelectorAll("#tab-project-chat .msg.assistant")].slice(-1)[0]?.textContent||""');
  check('the follow-up resumed the same agent session', /resume=sim-/.test(reply), reply);
  await sleep(3200);
  check('the hero falls asleep after the follow-up finishes', await ev('document.getElementById("hero").classList.contains("sleeping")'));
  await shot('3-follow-up');
} catch (err) {
  console.log(`FAIL  simulation error: ${err.message}`);
  results.push(false);
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  app.kill();
  fs.rmSync(work, { recursive: true, force: true });
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshots: ${outDir}`);
process.exit(failed ? 1 : 0);
