// Runs Claude Code headlessly (`claude -p --output-format stream-json`) and
// turns its event stream into small, UI-friendly events.

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isWin = process.platform === 'win32';

// GUI apps on macOS don't inherit the shell PATH, so add the usual spots.
const EXTRA_PATHS = [
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.claude', 'local'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
];

function childEnv() {
  const sep = isWin ? ';' : ':';
  return { ...process.env, PATH: [...EXTRA_PATHS, process.env.PATH].join(sep) };
}

let cachedBin = null;

function resolveClaudeBinary() {
  if (cachedBin) return cachedBin;
  if (process.env.CLAUDE_BIN) return (cachedBin = process.env.CLAUDE_BIN);

  if (!isWin) {
    for (const dir of EXTRA_PATHS) {
      const candidate = path.join(dir, 'claude');
      if (fs.existsSync(candidate)) return (cachedBin = candidate);
    }
    try {
      const shell = process.env.SHELL || '/bin/zsh';
      // Timeout: a slow login shell would otherwise freeze the main process.
      const found = execFileSync(shell, ['-lc', 'command -v claude'], { encoding: 'utf8', timeout: 5000 }).trim();
      if (found) return (cachedBin = found);
    } catch {}
  }
  return (cachedBin = 'claude');
}


/**
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} opts.cwd
 * @param {string|null} opts.sessionId  resume this session if set
 * @param {string} opts.permissionMode
 * @param {(event: object) => void} emit
 * @returns {{cancel: function, running: boolean}} handle
 */
function run({ prompt, cwd, sessionId, permissionMode, model }, emit) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', permissionMode || 'default',
  ];
  if (sessionId) args.push('--resume', sessionId);
  if (model) args.push('--model', model);

  const bin = resolveClaudeBinary();
  emit({ type: 'start' });

  let child = null;
  // 'end' must be emitted exactly once: the renderer stays "busy" until it
  // arrives, and a spawn failure may fire 'error' without 'close'.
  const finish = (code) => {
    if (!handle.running) return;
    handle.running = false;
    emit({ type: 'end', code });
  };
  const handle = {
    running: true,
    cancel() {
      if (!child || !handle.running) return;
      if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
      else child.kill('SIGINT');
    },
  };

  try {
    child = spawn(bin, args, { cwd, env: childEnv(), shell: isWin });
  } catch (err) {
    emit({ type: 'error', message: `Could not start Claude: ${err.message}` });
    finish(-1);
    return handle;
  }

  // If the binary is missing, writing the prompt raises EPIPE on stdin; an
  // unhandled stream 'error' would crash the main process.
  child.stdin.on('error', () => {});
  // Prompt goes over stdin so quoting and length are never an issue.
  child.stdin.end(prompt);

  let buffer = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        handleMessage(JSON.parse(line), emit);
      } catch {
        // Ignore non-JSON lines.
      }
    }
  });

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  child.on('error', (err) => {
    const hint = err.code === 'ENOENT'
      ? ' Is Claude Code installed? Set CLAUDE_BIN to its path if it lives somewhere unusual.'
      : '';
    emit({ type: 'error', message: `${err.message}.${hint}` });
    // Spawn failures don't always produce 'close'.
    if (child.pid === undefined) finish(-1);
  });

  child.on('close', (code) => {
    if (code !== 0 && stderr.trim() && handle.running) emit({ type: 'error', message: stderr.trim() });
    finish(code);
  });

  return handle;
}

function handleMessage(msg, emit) {
  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init') emit({ type: 'session', sessionId: msg.session_id, model: msg.model });
      break;

    case 'stream_event': {
      const ev = msg.event;
      // One message_delta per model call, carrying that call's final usage.
      if (ev?.type === 'message_start' && ev.message?.usage) {
        // Start of a model call: input and cache tokens are already known.
        emit({ type: 'turn', usage: normalizeUsage(ev.message.usage) });
      } else if (ev?.type === 'message_delta' && ev.usage) {
        emit({ type: 'usage', usage: normalizeUsage(ev.usage) });
      } else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        emit({ type: 'text', text: ev.delta.text });
      } else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') {
        emit({ type: 'thinking', text: ev.delta.thinking });
      } else if (ev?.type === 'content_block_start' && ev.content_block?.type === 'thinking') {
        emit({ type: 'thinking' });
      }
      break;
    }

    case 'assistant':
      // Text already arrived as deltas; only pick out tool calls here.
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') {
          emit({ type: 'tool', name: block.name, summary: summarizeToolInput(block.input) });
        }
      }
      break;

    case 'result':
      emit({
        type: 'result',
        isError: msg.is_error,
        sessionId: msg.session_id,
        costUsd: msg.total_cost_usd,
        turns: msg.num_turns,
        durationMs: msg.duration_ms,
        contextWindow: Math.max(0, ...Object.values(msg.modelUsage || {}).map((m) => m.contextWindow || 0)) || null,
      });
      break;
  }
}

function normalizeUsage(u) {
  return {
    input: u.input_tokens || 0,
    output: u.output_tokens || 0,
    cacheRead: u.cache_read_input_tokens || 0,
    cacheCreate: u.cache_creation_input_tokens || 0,
  };
}

function summarizeToolInput(input = {}) {
  const value = input.command || input.file_path || input.pattern || input.url || input.description || '';
  const text = String(value).replace(/\s+/g, ' ');
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

module.exports = { run, resolveClaudeBinary };
