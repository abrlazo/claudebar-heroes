// Simulates agents started with "/<agent-name> <task>" against the built app without
// calling the real Claude. A fake `claude` (CLAUDE_BIN) streams tool calls and text, the app
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
agent="none"
mode="default"
stream_in=0
while [ $# -gt 0 ]; do if [ "$1" = "--resume" ]; then resume="$2"; fi; if [ "$1" = "--agent" ]; then agent="$2"; fi; if [ "$1" = "--permission-mode" ]; then mode="$2"; fi; if [ "$1" = "--input-format" ]; then stream_in=1; fi; shift; done
if [ "$stream_in" = "1" ]; then
  read -r request
  printf '%s\\n' '{"type":"control_response","response":{"subtype":"success","request_id":"cmd-list","response":{"commands":[{"name":"compact","description":"Free up context by summarizing the conversation so far","argumentHint":"<optional custom summarization instructions>"},{"name":"context","description":"Show current context usage","argumentHint":""},{"name":"model","description":"Set the AI model for Claude Code","argumentHint":"<model>"},{"name":"doctor","description":"Diagnose the setup","argumentHint":""},{"name":"__remote-workflow","description":"Internal","argumentHint":""},{"name":"deploy","description":"A real skill","argumentHint":""},{"name":"ship","description":"A custom command","argumentHint":"<env>"},{"name":"git:sync","description":"A namespaced command","argumentHint":""},{"name":"docx","description":"Word documents (claude.ai sync)","argumentHint":""}]}}}'
  exit 0
fi
prompt=$(cat)
sid="sim-$RANDOM"
if [[ "$prompt" == /context* ]]; then
  printf '%s\\n' "{\\"type\\":\\"system\\",\\"subtype\\":\\"init\\",\\"session_id\\":\\"$sid\\",\\"model\\":\\"fake\\"}"
  printf '%s\\n' "{\\"type\\":\\"assistant\\",\\"message\\":{\\"content\\":[{\\"type\\":\\"text\\",\\"text\\":\\"CONTEXT-OUTPUT\\"}]}}"
  printf '%s\\n' "{\\"type\\":\\"result\\",\\"is_error\\":false,\\"session_id\\":\\"$sid\\",\\"total_cost_usd\\":0,\\"num_turns\\":1,\\"duration_ms\\":50}"
  exit 0
fi
dur=$(( (RANDOM % 5) + 6 ))
printf '%s\\n' "{\\"type\\":\\"system\\",\\"subtype\\":\\"init\\",\\"session_id\\":\\"$sid\\",\\"model\\":\\"fake\\"}"
sleep 1
for tool in Read Grep Edit; do
  printf '%s\\n' "{\\"type\\":\\"assistant\\",\\"message\\":{\\"content\\":[{\\"type\\":\\"tool_use\\",\\"name\\":\\"$tool\\",\\"input\\":{\\"file_path\\":\\"/repo/$tool.ts\\"}}]}}"
  sleep $(( dur / 3 ))
done
printf '%s\\n' "{\\"type\\":\\"stream_event\\",\\"event\\":{\\"type\\":\\"content_block_delta\\",\\"delta\\":{\\"type\\":\\"text_delta\\",\\"text\\":\\"done (agent=$agent resume=$resume mode=$mode)\\"}}}"
printf '%s\\n' "{\\"type\\":\\"result\\",\\"is_error\\":false,\\"session_id\\":\\"$sid\\",\\"total_cost_usd\\":0.002,\\"num_turns\\":3,\\"duration_ms\\":\${dur}000}"
`, { mode: 0o755 });

// ----- a throwaway project with three agents (and a skill, which is not an agent) -----
const project = path.join(work, 'project');
fs.mkdirSync(path.join(project, '.claude', 'agents'), { recursive: true });
fs.mkdirSync(path.join(project, '.claude', 'skills'), { recursive: true });
for (const name of ['alpha', 'beta', 'gamma']) {
  fs.writeFileSync(path.join(project, '.claude', 'agents', `${name}.md`), `---\nname: ${name}\ndescription: Simulated ${name} agent\n---\n\nYou are ${name}.\n`);
}
// run.md is a flat file (not skills/<name>/SKILL.md), so Claude does not load it as a skill.
fs.writeFileSync(path.join(project, '.claude', 'skills', 'run.md'), '---\nname: run\ndescription: A flat file, not a real skill\n---\n');
fs.mkdirSync(path.join(project, '.claude', 'skills', 'deploy'), { recursive: true });
fs.writeFileSync(path.join(project, '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: A real skill\n---\n');
fs.mkdirSync(path.join(project, '.claude', 'commands', 'git'), { recursive: true });
fs.writeFileSync(path.join(project, '.claude', 'commands', 'ship.md'), '---\ndescription: A custom command\nargument-hint: <env>\n---\nShip it.\n');
fs.writeFileSync(path.join(project, '.claude', 'commands', 'git', 'sync.md'), '---\ndescription: A namespaced command\n---\nSync.\n');

// ----- isolated settings: one project, no real data touched -----
const userData = path.join(work, 'userData');
fs.mkdirSync(userData);
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  permissionMode: 'default', windowPos: null, theme: 'dark', panelHeight: 500, activeId: 'sim-ws',
  workspaces: [{
    id: 'sim-ws', path: project, name: 'simulation', heroSeed: 'simulation-seed',
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
const key = (selector, k) => ev(`(()=>{const t=document.querySelector(${JSON.stringify(selector)});
  t.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true,cancelable:true}));})()`);
const popupNames = async () => JSON.parse(await ev('JSON.stringify([...document.querySelectorAll(".command-popup .command-name")].map(e=>e.textContent))'));
const textareaValue = () => ev('document.querySelector("#tab-project-chat textarea").value');
const allDone = () => ev('(()=>{const s=[...document.querySelectorAll(".agent-tab .status")];return s.length>0&&s.every(x=>x.textContent==="done")})()');

try {
  await connect();
  await sleep(1500);
  await click('#toggle-panel');
  await sleep(900);

  // ----- the "/" suggestion popup -----
  const ta = '#tab-project-chat textarea';
  await type(ta, '/');
  await sleep(500);
  const all = await popupNames();
  check('typing "/" opens a popup with the agents', ['/alpha', '/beta', '/gamma'].every((n) => all.includes(n)), all.join(' '));
  check('...Claude\'s own commands (built-ins, skills, custom commands)', ['/compact', '/context', '/model', '/deploy', '/ship', '/git:sync', '/docx'].every((n) => all.includes(n)), all.join(' '));
  check('...the app\'s own /plan and summon', ['/plan', 'summon'].every((n) => all.includes(n)));
  check('...but not terminal-only or internal commands, nor the flat "run" file', !all.includes('/doctor') && !all.includes('/__remote-workflow') && !all.includes('/run'), all.join(' '));
  const kinds = JSON.parse(await ev('JSON.stringify(Object.fromEntries([...document.querySelectorAll(".command-item")].map(e=>[e.querySelector(".command-name").textContent, e.querySelector(".command-kind").textContent])))'));
  check('each entry is labelled by kind', kinds['/alpha'] === 'agent' && kinds['/compact'] === 'built-in' && kinds['/deploy'] === 'skill' && kinds['/docx'] === 'skill' && kinds['/ship'] === 'command' && kinds['/plan'] === 'app', JSON.stringify(kinds));
  await type(ta, '/alp');
  await sleep(250);
  const filtered = await popupNames();
  check('typing narrows the list', filtered[0] === '/alpha' && !filtered.includes('/beta'), filtered.join(' '));
  await key(ta, 'Enter');
  await sleep(250);
  check('Enter picks the suggestion instead of sending it', (await textareaValue()) === '/alpha ' && (await ev('document.querySelectorAll(".agent-tab").length')) === 0);
  await type(ta, '/');
  await sleep(250);
  await key(ta, 'ArrowDown');
  await key(ta, 'Tab');
  await sleep(250);
  const second = await textareaValue();
  check('Down + Tab picks the next suggestion', /^\/[A-Za-z:-]+ $/.test(second) && second !== all[0] + ' ', second);
  await type(ta, '/');
  await sleep(250);
  await key(ta, 'Escape');
  await sleep(250);
  check('Esc closes the popup but not the panel', (await popupNames()).length === 0 && !(await ev('document.getElementById("panel").classList.contains("hidden")')));
  await type(ta, '/zzzz-nothing');
  await sleep(250);
  check('no popup when nothing matches', (await popupNames()).length === 0);
  await type(ta, '/summ');
  await sleep(250);
  await key(ta, 'Enter');
  await sleep(250);
  check('picking the app command inserts "summon "', (await textareaValue()) === 'summon ', await textareaValue());
  await type(ta, '');
  await sleep(150);

  for (const name of ['alpha', 'beta', 'gamma']) {
    await type('#tab-project-chat textarea', `/${name} investigate the repository and report back`);
    await sleep(150);
    await click('#tab-project-chat .send');
    await sleep(700);
  }
  await sleep(3500);
  await shot('1-agents-running');

  const tabs = await ev('document.querySelectorAll(".agent-tab").length');
  check('/alpha, /beta, /gamma each started an agent (plus the Expedition tab)', tabs === 4, `${tabs} tabs`);
  const tabNames = await ev('JSON.stringify([...document.querySelectorAll(".agent-tab")].map(t=>t.childNodes[0]?.textContent?.trim()))');
  check('each agent tab is named after its agent', tabNames === JSON.stringify(['Expedition', 'alpha', 'beta', 'gamma']), tabNames);
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
  check('messaging an agent keeps its tab selected', /beta/.test(active), active);
  for (let i = 0; i < 40 && !(await allDone()); i++) await sleep(500);
  const reply = await ev('[...document.querySelectorAll("#tab-project-chat .msg.assistant")].slice(-1)[0]?.textContent||""');
  check('the follow-up resumed the same session, as the same agent', /agent=beta resume=sim-/.test(reply), reply);
  await sleep(3200);
  check('the hero falls asleep after the follow-up finishes', await ev('document.getElementById("hero").classList.contains("sleeping")'));
  await shot('3-follow-up');

  // Things that are not agents must not spawn one.
  await click('.agent-tab:first-child'); // back to the Expedition chat
  await sleep(300);
  await type('#tab-project-chat textarea', '/alpha');
  await sleep(150);
  await click('#tab-project-chat .send');
  await sleep(500);
  check('"/alpha" with no task asks for one instead of starting an agent',
    (await ev('document.querySelectorAll(".agent-tab").length')) === 4
      && /Tell alpha what to do/.test(await ev('[...document.querySelectorAll("#tab-project-chat .msg.meta")].slice(-1)[0]?.textContent||""')));

  await type('#tab-project-chat textarea', '/run hello');
  await sleep(150);
  await click('#tab-project-chat .send');
  await sleep(600);
  check('"/run" (a skill, not an agent) starts no agent', (await ev('document.querySelectorAll(".agent-tab").length')) === 4);
  for (let i = 0; i < 40 && (await ev('!!document.querySelector("#tab-project-chat .stop")')); i++) await sleep(500);
  const plain = await ev('[...document.querySelectorAll("#tab-project-chat .msg.assistant")].slice(-1)[0]?.textContent||""');
  check('"/run hello" went to Claude as an ordinary message (no --agent)', /agent=none/.test(plain), plain);

  // A built-in command answers with one complete message and no streamed chunks; it must still show up.
  await type('#tab-project-chat textarea', '/context ');
  await sleep(150);
  await click('#tab-project-chat .send');
  for (let i = 0; i < 20 && !/CONTEXT-OUTPUT/.test(await ev('document.getElementById("tab-project-chat").innerText')); i++) await sleep(250);
  check('output of a built-in command (no streamed text) appears in the chat', /CONTEXT-OUTPUT/.test(await ev('document.getElementById("tab-project-chat").innerText')));
  for (let i = 0; i < 40 && (await ev('!!document.querySelector("#tab-project-chat .stop")')); i++) await sleep(250);

  // /plan switches to plan mode (the "Plan only" permission mode); with a task it sends the task in that mode.
  await type('#tab-project-chat textarea', '/plan ');
  await sleep(150);
  await click('#tab-project-chat .send');
  await sleep(500);
  check('"/plan" switches the permission mode to Plan only',
    (await ev('document.getElementById("permission-mode").value')) === 'plan'
      && /Plan mode is on/.test(await ev('[...document.querySelectorAll("#tab-project-chat .msg.meta")].slice(-1)[0]?.textContent||""')));
  await ev('(()=>{const s=document.getElementById("permission-mode");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(s,"default");s.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await sleep(300);
  const repliesBefore = await ev('document.querySelectorAll("#tab-project-chat .msg.assistant").length');
  await type('#tab-project-chat textarea', '/plan outline the work');
  await sleep(150);
  await click('#tab-project-chat .send');
  for (let i = 0; i < 60 && (await ev('document.querySelectorAll("#tab-project-chat .msg.assistant").length')) <= repliesBefore; i++) await sleep(250);
  const planReply = await ev('[...document.querySelectorAll("#tab-project-chat .msg.assistant")].slice(-1)[0]?.textContent||""');
  check('"/plan <task>" sends the task to Claude in plan mode', /mode=plan/.test(planReply), planReply);
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
