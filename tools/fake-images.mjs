// A fake `claude` for tools/simulate-images.mjs. It speaks the host stream-json protocol like tools/fake-perm.mjs
// (the prompt is ONE JSON user line on stdin, stdin stays open until the `result`), and answers by describing what
// it received: "got N images: image/png:<decoded bytes>,image/jpeg:<decoded bytes> text=<the text block>".
// A prompt containing SLOW takes 4 s, so a test can queue messages behind it.
//
// Files (paths from the environment): FAKE_RUNS gets one line per run "<n images>|<text>|<block order>" and
// FAKE_ARGS the argv.

import fs from 'node:fs';
import readline from 'node:readline';

const argv = process.argv.slice(2);
const append = (file, line) => { if (file) fs.appendFileSync(file, `${line}\n`); };
const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const sid = `img-${Math.floor(Math.random() * 1e6)}`;
append(process.env.FAKE_ARGS, argv.join(' '));

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
  const content = msg.message?.content ?? [];
  const images = content.filter((b) => b.type === 'image');
  const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const sizes = images.map((b) => `${b.source?.media_type}:${Buffer.from(b.source?.data ?? '', 'base64').length}`);
  append(process.env.FAKE_RUNS, `${images.length}|${text.replace(/\n/g, ' ')}|${content.map((b) => b.type[0]).join('')}`);
  out({ type: 'system', subtype: 'init', session_id: sid, model: 'fake' });
  const say = (t) => out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: t } } });
  setTimeout(() => {
    say(`got ${images.length} images: ${sizes.join(',')} text=${text}`);
    out({ type: 'result', subtype: 'success', is_error: false, session_id: sid, total_cost_usd: 0.001, num_turns: 1, duration_ms: 100 });
    setTimeout(() => process.exit(0), 100);
  }, text.includes('SLOW') ? 4000 : 300);
});
rl.on('close', () => { if (!got) process.exit(0); });
process.on('SIGINT', () => {
  out({ type: 'result', subtype: 'success', is_error: false, session_id: sid, total_cost_usd: 0, num_turns: 1, duration_ms: 10 });
  process.exit(0);
});
