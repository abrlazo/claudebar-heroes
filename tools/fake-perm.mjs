// A fake `claude` for tools/simulate-perm.mjs that speaks the permission protocol captured from the real CLI
// (Claude Code 2.1.292): with `--input-format stream-json --permission-prompt-tool stdio` the prompt arrives as one
// JSON user line, a tool that needs permission is announced by a `control_request` (`can_use_tool`) on stdout, and the
// run waits for a `control_response` on stdin (first answer for an id wins, unknown ids are ignored). On SIGINT it
// sends `control_cancel_request` for what it waits on, then `result`. Prompts: PERMALLOW, PERMTWO, PERMSTALL,
// PERMASKQ, PERMBIG, PERMSUB, PERMMODE (tool 1, a 3 s gap, then tool 2 announced unless the live mode is
// bypassPermissions, like the real CLI); anything else is a short plain run that echoes how it was started.
// `control_request` `set_permission_mode` is answered like the real CLI: success with the mode, `bypass_not_launched`
// when Bypass was not allowed at launch (`--allow-dangerously-skip-permissions` or `--permission-mode bypassPermissions`),
// `invalid_mode` for anything else. FAKE_NO_SETMODE=1 never answers (an old CLI), FAKE_SETMODE_ERROR=1 always errors, FAKE_REJECT_HOST=1 rejects the host flags.
//
// Files (paths from the environment): FAKE_ARGS gets one line per start with the argv, FAKE_RUNS "<cwd>|<prompt>",
// FAKE_RESPONSES every permission answer the app writes to stdin after the prompt (so a test sees exactly what was
// answered), FAKE_MODES every `set_permission_mode` line (kept apart so they do not count as answers).

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
// FAKE_REJECT_HOST=1: an old Claude that does not know the host flags (fails before any session, like the real one).
if (process.env.FAKE_REJECT_HOST === '1' && argv.includes('--permission-prompt-tool')) {
  process.stderr.write("error: unknown option '--permission-prompt-tool'\n");
  process.exit(1);
}
const MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
let curMode = flag('--permission-mode') ?? 'default';
const bypassAllowed = argv.includes('--allow-dangerously-skip-permissions') || curMode === 'bypassPermissions';

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
  try {
    const msg = JSON.parse(line);
    if (msg.type === 'control_request' && msg.request?.subtype === 'set_permission_mode') {
      append(process.env.FAKE_MODES, line);
      const rid = msg.request_id;
      const mode = msg.request.mode;
      const reply = (response) => out({ type: 'control_response', response: { request_id: rid, ...response } });
      if (process.env.FAKE_NO_SETMODE === '1') return;
      if (process.env.FAKE_SETMODE_ERROR === '1' || !MODES.includes(mode)) reply({ subtype: 'error', error: 'Cannot set permission mode', error_code: 'invalid_mode' });
      else if (mode === 'bypassPermissions' && !bypassAllowed) reply({ subtype: 'error', error: 'not launched with --dangerously-skip-permissions', error_code: 'bypass_not_launched' });
      else { curMode = mode; reply({ subtype: 'success', response: { mode } }); }
      return;
    }
    append(process.env.FAKE_RESPONSES, line);
    const id = msg?.response?.request_id;
    if (msg.type === 'control_response' && typeof id === 'string' && pendingIds.has(id) && !answers.has(id)) {
      answers.set(id, msg.response.response ?? msg.response);
      for (const w of waiters.splice(0)) w();
    }
  } catch { /* ignore */ }
});
rl.on('close', () => { if (!gotFirst) promptResolve(''); else if (streamIn) process.exit(0); });

// An agent's request ids get its name as a suffix, so a Quest run and an agent can wait at the same time (the app
// keys its cards by request id, like the real CLI's unique ids).
const idSuffix = flag('--agent') ? `-${flag('--agent')}` : '';
const waitFor = (rawId) => new Promise((resolve) => {
  const id = `${rawId}${idSuffix}`;
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
const ask = (rawId, name, input, extra = {}) => {
  const id = `${rawId}${idSuffix}`;
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
  else { toolResult(response.message ?? 'denied', true); say(`perm denied ${name}: ${response.message ?? ''}`); }
};

// Pipeline simulation prompts (tools/simulate-pipeline.mjs): PIPELONG = six tool calls with text in between (~9 s, clean),
// PIPETEXT = one tool call, then only streamed text for ~4 s, PIPEQUICK = one tool call, clean after ~2.5 s,
// PIPEFAIL = one tool call, then an error result after ~1.5 s.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
if (prompt.includes('PIPELONG')) {
  for (let i = 1; i <= 6; i++) { toolUse('Bash', { command: `step ${i}` }); say(`step ${i} `); await pause(1500); }
  say('long done');
  finish();
} else if (prompt.includes('PIPETEXT')) {
  toolUse('Read', { file_path: '/repo/text.ts' });
  for (let i = 0; i < 40; i++) { say(`chunk ${i} `); await pause(100); }
  finish();
} else if (prompt.includes('PIPEQUICK')) {
  toolUse('Read', { file_path: '/repo/quick.ts' });
  await pause(2500);
  say('quick done');
  finish();
} else if (prompt.includes('PIPEFAIL')) {
  toolUse('Bash', { command: 'false' });
  await pause(1500);
  out({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: sid, total_cost_usd: 0, num_turns: 1, duration_ms: 100 });
  setTimeout(() => process.exit(1), 100);
} else if (prompt.includes('PERMALLOW')) {
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
} else if (prompt.includes('PERMMODE')) {
  ask('mode-1', 'Bash', { command: 'mkdir mode-one' });
  settle('first', await waitFor('mode-1'), () => fs.mkdirSync(path.join(process.cwd(), 'mode-one'), { recursive: true }));
  await new Promise((r) => setTimeout(r, 3000)); // the work gap in which a test switches the mode
  if (curMode === 'bypassPermissions') {
    fs.mkdirSync(path.join(process.cwd(), 'mode-two'), { recursive: true });
    toolResult('ok', false);
    say('second ran without asking');
  } else {
    ask('mode-2', 'Bash', { command: 'mkdir mode-two' });
    settle('second', await waitFor('mode-2'), () => fs.mkdirSync(path.join(process.cwd(), 'mode-two'), { recursive: true }));
  }
  say(` mode-end=${curMode}`);
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
  say(`plain done (live=${curMode} agent=${flag('--agent') ?? 'none'} resume=${flag('--resume') ?? 'none'} mode=${flag('--permission-mode') ?? 'default'} stdin=${streamIn ? 'stream' : 'text'}) task=${prompt.replace(/\n/g, ' ').slice(0, 200)}`);
  finish();
}
