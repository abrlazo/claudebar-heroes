// A fake `claude` for tools/simulate-perm.mjs that speaks the permission protocol captured from the real CLI
// (Claude Code 2.1.292): with `--input-format stream-json --permission-prompt-tool stdio` the prompt arrives as one
// JSON user line, a tool that needs permission is announced by a `control_request` (`can_use_tool`) on stdout, and the
// run waits for a `control_response` on stdin (first answer for an id wins, unknown ids are ignored). On SIGINT it
// sends `control_cancel_request` for what it waits on, then `result`. Prompts: PERMALLOW, PERMTWO, PERMSTALL,
// PERMASKQ, PERMBIG, PERMSUB; anything else is a short plain run that echoes how it was started.
//
// Files (paths from the environment): FAKE_ARGS gets one line per start with the argv, FAKE_RUNS "<cwd>|<prompt>",
// FAKE_RESPONSES every line the app writes to stdin after the prompt (so a test sees exactly what was answered).

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i === -1 ? null : (argv[i + 1] ?? ''); };
const append = (file, line) => { if (file) fs.appendFileSync(file, `${line}\n`); };
const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const sid = `perm-${Math.floor(Math.random() * 1e6)}`;
const streamIn = argv.includes('--input-format');
append(process.env.FAKE_ARGS, argv.join(' '));

const lines = [];
const waiters = [];
const rl = readline.createInterface({ input: process.stdin });
const answers = new Map(); // request_id -> response (first wins)
const pendingIds = new Set();
let promptResolve;
const firstLine = new Promise((r) => { promptResolve = r; });
let gotFirst = false;
rl.on('line', (line) => {
  if (!line.trim()) return;
  if (!gotFirst) { gotFirst = true; promptResolve(line); return; }
  if (!streamIn) return; // plain mode: the rest of the prompt text
  append(process.env.FAKE_RESPONSES, line);
  try {
    const msg = JSON.parse(line);
    const id = msg?.response?.request_id;
    if (msg.type === 'control_response' && typeof id === 'string' && pendingIds.has(id) && !answers.has(id)) {
      answers.set(id, msg.response.response ?? msg.response);
      for (const w of waiters.splice(0)) w();
    }
  } catch { /* ignore */ }
});
rl.on('close', () => { if (!gotFirst) promptResolve(''); else if (streamIn) process.exit(0); });

const waitFor = (id) => new Promise((resolve) => {
  const check = () => (answers.has(id) ? resolve(answers.get(id)) : waiters.push(check));
  check();
});

// Like the real CLI, Stop takes a moment: it cancels what it waits on, then ends with a result.
process.on('SIGINT', () => setTimeout(() => {
  for (const id of pendingIds) if (!answers.has(id)) out({ type: 'control_cancel_request', request_id: id });
  out({ type: 'result', subtype: 'success', is_error: false, stop_reason: 'tool_use', session_id: sid, total_cost_usd: 0, num_turns: 1, duration_ms: 10 });
  process.exit(0);
}, 300));

const first = await firstLine;
let prompt = first;
if (streamIn) {
  try { prompt = JSON.parse(first).message.content[0].text; } catch { prompt = ''; }
  if (first.includes('"subtype":"initialize"')) {
    out({ type: 'control_response', response: { subtype: 'success', request_id: 'cmd-list', response: { commands: [{ name: 'context', description: 'Show context', argumentHint: '' }] } } });
    process.exit(0);
  }
} else {
  // Plain mode: the prompt is everything on stdin until it closes.
  prompt = first;
}
append(process.env.FAKE_RUNS, `${process.cwd()}|${prompt.replace(/\n/g, ' ').slice(0, 300)}`);
out({ type: 'system', subtype: 'init', session_id: sid, model: 'fake' });

const toolUse = (name, input) => out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_perm', name, input }] } });
const ask = (id, name, input, extra = {}) => {
  pendingIds.add(id);
  toolUse(name, input);
  out({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: name, display_name: name, input, tool_use_id: 'toolu_perm', ...extra } });
};
const say = (text) => out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const toolResult = (text, isError) => out({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_perm', content: text, is_error: isError }] } });
const finish = () => {
  out({ type: 'result', subtype: 'success', is_error: false, session_id: sid, total_cost_usd: 0.001, num_turns: 1, duration_ms: 100 });
  setTimeout(() => process.exit(0), 100);
};
const settle = (name, response, make) => {
  if (response.behavior === 'allow') { make(); toolResult('ok', false); say(`perm allowed ${name}`); }
  else { toolResult(response.message ?? 'denied', true); say(`perm denied ${name}`); }
};

if (prompt.includes('PERMALLOW')) {
  ask('req-allow-1', 'Bash', { command: 'mkdir perm-allow-dir', description: 'Make a directory' });
  const r = await waitFor('req-allow-1');
  settle('one', r, () => fs.mkdirSync(path.join(process.cwd(), 'perm-allow-dir'), { recursive: true }));
  finish();
} else if (prompt.includes('PERMTWO')) {
  ask('two-1', 'Bash', { command: 'mkdir two-a' });
  ask('two-2', 'Write', { file_path: path.join(process.cwd(), 'two-b.txt'), content: 'second' });
  const a = await waitFor('two-1');
  say(a.behavior === 'allow' ? 'first allowed ' : 'first denied ');
  const b = await waitFor('two-2');
  say(b.behavior === 'allow' ? 'second allowed' : 'second denied');
  finish();
} else if (prompt.includes('PERMSTALL')) {
  ask('stall-1', 'Bash', { command: 'sleep 1000' });
  await waitFor('stall-1');
  say('stall answered');
  finish();
} else if (prompt.includes('PERMASKQ')) {
  ask('askq-1', 'AskUserQuestion', { questions: [{ question: 'Which one?', options: ['a', 'b'] }] }, { requires_user_interaction: true });
  await waitFor('askq-1');
  say('asked in plain text instead');
  finish();
} else if (prompt.includes('PERMSUB')) {
  ask('sub-1', 'Bash', { command: 'echo delegated' }, { agent_id: 'a219918ea6ee9ac70' });
  const r = await waitFor('sub-1');
  say(r.behavior === 'allow' ? 'sub allowed' : 'sub denied');
  finish();
} else if (prompt.includes('PERMBIG')) {
  const lines3000 = Array.from({ length: 3000 }, (_, i) => `echo line-${i}`).join('\n');
  const hostile = `<img src=x onerror="window.__pwned=1"> <b>bold</b>‮ reversed \u0007bell\n${lines3000}\n${'Z'.repeat(100000)}`;
  ask('big-1', 'Bash', { command: hostile });
  await waitFor('big-1');
  say('big answered');
  finish();
} else {
  // Plain run: how it was started, so the checks can see the mode (and that a resumed session keeps working).
  await new Promise((r) => setTimeout(r, 300));
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/repo/a.ts' } }] } });
  say(`plain done (agent=${flag('--agent') ?? 'none'} resume=${flag('--resume') ?? 'none'} mode=${flag('--permission-mode') ?? 'default'} stdin=${streamIn ? 'stream' : 'text'}) task=${prompt.replace(/\n/g, ' ').slice(0, 200)}`);
  finish();
}
