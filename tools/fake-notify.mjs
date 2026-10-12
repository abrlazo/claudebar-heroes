// A minimal fake `claude` for tools/simulate-notify.mjs (the notification simulation). The app always starts project
// runs in stream-json host mode: the prompt arrives as one JSON user line, stdin stays open until the `result`.
// Prompts: NOTIFYQUICK (clean after ~1.2 s), NOTIFYLONG (clean after ~3 s), NOTIFYFAIL (stderr with a path and a key,
// exit 1 at once), NOTIFYHOLD (runs until Stop, then ends like the real CLI: a result and exit); anything else is quick.

import readline from 'node:readline';

const argv = process.argv.slice(2);
const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const sid = `notify-${Math.floor(Math.random() * 1e6)}`;
const rl = readline.createInterface({ input: process.stdin });
let promptResolve;
const firstLine = new Promise((r) => { promptResolve = r; });
let got = false;
rl.on('line', (line) => { if (line.trim() && !got) { got = true; promptResolve(line); } });
rl.on('close', () => { if (!got) promptResolve(''); else process.exit(0); });

process.on('SIGINT', () => setTimeout(() => {
  out({ type: 'result', subtype: 'success', is_error: false, session_id: sid, total_cost_usd: 0, num_turns: 1, duration_ms: 10 });
  process.exit(0);
}, 200));

const first = await firstLine;
let prompt = first;
try { prompt = JSON.parse(first).message.content[0].text; } catch { /* plain text */ }
if (first.includes('"subtype":"initialize"')) {
  out({ type: 'control_response', response: { subtype: 'success', request_id: 'cmd-list', response: { commands: [{ name: 'context', description: 'Show context', argumentHint: '' }] } } });
  process.exit(0);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
out({ type: 'system', subtype: 'init', session_id: sid, model: 'fake' });
const say = (text) => out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const finish = () => {
  out({ type: 'result', subtype: 'success', is_error: false, session_id: sid, total_cost_usd: 0, num_turns: 1, duration_ms: 100 });
  setTimeout(() => process.exit(0), 50);
};

if (prompt.includes('NOTIFYFAIL')) {
  process.stderr.write('Fatal: boom while reading /Users/someone/secret/project with key sk-ant-SECRET999\n');
  process.exit(1);
} else if (prompt.includes('NOTIFYHOLD')) {
  say('holding');
  await new Promise(() => {}); // until Stop
} else if (prompt.includes('NOTIFYLONG')) {
  await sleep(3000);
  say(`long done agent=${argv.includes('--agent') ? 'yes' : 'no'}`);
  finish();
} else {
  await sleep(1200);
  say('quick done');
  finish();
}
