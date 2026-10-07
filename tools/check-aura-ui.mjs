// UI check for the level aura's pose: in the real app (isolated user data, fake `claude`) a level 30 hero
// sleeps, so the aura must lie along the lying body; once Claude works it must stand around the upright body.
// Measures the aura canvas pixels over the CDP, no screenshots. Needs a build (`npm run simulate` does it).
// Usage: node tools/check-aura-ui.mjs   (exit code 1 if a check fails)

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = createRequire(import.meta.url)('electron');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-aura-ui-'));
const port = 9800 + Math.floor(Math.random() * 90);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  aura ui: ${name}${detail ? `  (${detail})` : ''}`); };

// A claude that works for a while: an init event, then a tool call every 2 s.
const fake = path.join(work, 'fake-claude.sh');
fs.writeFileSync(fake, `#!/bin/bash
cat >/dev/null
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"s1","model":"fake"}'
for i in $(seq 1 30); do sleep 2 & wait $!; printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/x.ts"}}]}}'; done
`, { mode: 0o755 });

const project = path.join(work, 'project');
fs.mkdirSync(project);
const userData = path.join(work, 'userData');
fs.mkdirSync(userData);
// Level 30 needs 50 * 29^2 = 42,050 XP = 42,050,000 tokens (lib/leveling.ts).
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({
  permissionMode: 'default', windowPos: null, theme: 'dark', panelHeight: 500, activeId: 'w',
  workspaces: [{ id: 'w', path: project, name: 'aura', heroSeed: 'simulation-seed', usage: { input: 42_100_000, output: 0, cacheRead: 0, cacheCreate: 0 },
    lastContext: 0, contextWindow: 200000, kills: 0, map: 'forest', sessionId: null, messages: [], agents: [] }],
}));

const app = spawn(electronBin, [root, `--user-data-dir=${userData}`, `--remote-debugging-port=${port}`], { env: { ...process.env, CLAUDE_BIN: fake }, stdio: 'ignore' });
let ws;
try {
  for (let i = 0; i < 40 && !ws; i++) {
    try {
      const page = (await (await fetch(`http://localhost:${port}/json`)).json()).find((p) => p.type === 'page');
      if (page) ws = new WebSocket(page.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
    await sleep(500);
  }
  if (!ws) throw new Error('app did not start');
  if (ws.readyState !== 1) await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value;
  await send('Runtime.enable');
  await sleep(2500);

  // Mean x of the aura's visible pixels, their span, and whether the hero lies down (aura canvas px).
  const pose = () => ev(`(()=>{const c=document.getElementById('aura-canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let n=0,sx=0,x0=1e9,x1=-1;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){if(d[(y*c.width+x)*4+3]>20){n++;sx+=x;x0=Math.min(x0,x);x1=Math.max(x1,x);}}
    return {sleeping:document.getElementById('hero').classList.contains('sleeping'),n,mean:n?sx/n:0,span:x1-x0+1,w:c.width,cssW:c.getBoundingClientRect().width};})()`);
  // The aura is drawn each frame; sample a few frames so one quiet frame cannot fool the check.
  const sample = async () => { const out = []; for (let i = 0; i < 6; i++) { out.push(await pose()); await sleep(80); } return out.sort((a, b) => a.n - b.n)[3]; };

  const asleep = await sample();
  check('a level 30 hero sleeps with the aura drawn', asleep.sleeping && asleep.n > 0, `${asleep.n} px`);
  check('the canvas box matches the canvas (CSS = 2x)', asleep.cssW === asleep.w * 2, `${asleep.cssW} vs ${asleep.w}`);
  check('asleep: the aura lies along the body (centred near x 19, wider than the standing body)', Math.abs(asleep.mean - 19) <= 3 && asleep.span >= 18, `mean ${asleep.mean.toFixed(1)}, span ${asleep.span}`);

  await ev(`document.querySelector('#toggle-panel').click()`);
  await sleep(900);
  await ev(`(()=>{const t=document.querySelector('#tab-project-chat textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'work please');t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(150);
  await ev(`document.querySelector('#tab-project-chat .send').click()`);
  await sleep(2500);
  const awake = await sample();
  check('awake: the aura stands around the upright body (centred near x 15.5, narrow)', !awake.sleeping && Math.abs(awake.mean - 15.5) <= 2.5 && awake.span <= 20, `mean ${awake.mean.toFixed(1)}, span ${awake.span}`);
} catch (err) {
  console.log(`FAIL  aura ui: ${err.message}`);
  failed++;
} finally {
  try { ws?.close(); } catch { /* ignore */ }
  app.kill();
  fs.rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
