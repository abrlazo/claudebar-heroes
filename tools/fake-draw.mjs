// A fake `claude` for tools/simulate-draw.mjs.
//
// One-shot mode (`ask()`: no `--input-format`): reads the whole prompt from stdin and answers by the marker in the
// description, with the single JSON result line `claude -p --output-format json` prints:
//   DRAWOK     a valid 16x16 drawing after 1.2 s     DRAWQUICK  the same, at once
//   DRAWBIG    a valid 32x32 drawing                 DRAWSLOW   never answers (until killed)
//   DRAWPROSE  prose with no JSON                    DRAWEVIL   bad colours, 100 rows, ragged rows
//   DRAWHUGE   more than 64 KB of output             DRAWFAIL   exits with an error result
//   anything else (the summon design) answers with a short non-JSON text.
// Stream mode (`--input-format stream-json`, an ordinary run or an agent): the prompt is one JSON user line;
// BRIEFRUN takes 8 s, anything else 0.3 s, then a clean `result`.
//
// Files (from the environment): FAKE_ARGS one JSON line per start `{argv, cwd, pid, mode}`, FAKE_RUNS the prompt of
// every stream-mode run.

import fs from 'node:fs';
import readline from 'node:readline';

const argv = process.argv.slice(2);
const append = (file, line) => { if (file) fs.appendFileSync(file, `${line}\n`); };
const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const streamIn = argv.includes('--input-format');
append(process.env.FAKE_ARGS, JSON.stringify({ argv, cwd: process.cwd(), pid: process.pid, mode: streamIn ? 'stream' : 'ask' }));

export const grid = (w, h) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => {
  const edge = x === 1 || y === 1 || x === w - 2 || y === h - 2;
  if (x < 1 || y < 1 || x > w - 2 || y > h - 2) return '.';
  return edge ? '0' : (x + y) % 5 === 0 ? '2' : '1';
}).join(''));

if (!streamIn) {
  let prompt = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { prompt += c; });
  process.stdin.on('end', () => {
    const reply = (result, isError = false) => { out({ type: 'result', subtype: isError ? 'error' : 'success', is_error: isError, result }); process.exit(0); };
    const art = (w, h) => JSON.stringify({ palette: ['#14121F', '#d4a017', '#b32d1f'], rows: grid(w, h) });
    if (prompt.includes('DRAWSLOW')) { setInterval(() => {}, 1000); return; }
    if (prompt.includes('DRAWQUICK')) reply('```json\n' + art(16, 16) + '\n```');
    else if (prompt.includes('DRAWOK')) setTimeout(() => reply('Here you go: ' + art(16, 16)), 1200);
    else if (prompt.includes('DRAWBIG')) reply(art(32, 32));
    else if (prompt.includes('DRAWPROSE')) reply('I would love to draw that, but I only know words.');
    else if (prompt.includes('DRAWEVIL')) reply(JSON.stringify({ palette: ['red', 'url(x)'], rows: Array.from({ length: 100 }, (_, i) => 'x'.repeat(i % 7 + 3)) }));
    else if (prompt.includes('DRAWHUGE')) { process.stdout.write('{"type":"result","result":"' + 'x'.repeat(70 * 1024) + '"}\n'); setTimeout(() => process.exit(0), 3000); }
    else if (prompt.includes('DRAWFAIL')) reply('boom', true);
    else reply('no design');
  });
} else {
  const sid = `draw-${Math.floor(Math.random() * 1e6)}`;
  const rl = readline.createInterface({ input: process.stdin });
  let got = false;
  rl.on('line', (line) => {
    if (!line.trim() || got) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.type === 'control_request') {
      if (msg.request?.subtype === 'initialize') {
        out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: { commands: [] } } });
        process.exit(0);
      }
      return;
    }
    if (msg.type !== 'user') return;
    got = true;
    const text = (msg.message?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    append(process.env.FAKE_RUNS, text.replace(/\n/g, ' '));
    out({ type: 'system', subtype: 'init', session_id: sid, model: 'fake' });
    setTimeout(() => {
      out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: `ran: ${text}` } } });
      out({ type: 'result', subtype: 'success', is_error: false, session_id: sid, total_cost_usd: 0.001, num_turns: 1, duration_ms: 100 });
      setTimeout(() => process.exit(0), 100);
    }, text.includes('BRIEFRUN') ? 8000 : 300);
  });
  rl.on('close', () => { if (!got) process.exit(0); });
  process.on('SIGINT', () => {
    out({ type: 'result', subtype: 'success', is_error: false, session_id: sid, total_cost_usd: 0, num_turns: 1, duration_ms: 10 });
    process.exit(0);
  });
}
