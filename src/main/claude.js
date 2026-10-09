// Runs Claude Code headlessly (`claude -p --output-format stream-json`) and
// turns its event stream into small, UI-friendly events.

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const permissions = require('./permissions');

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


// "Ask me each time": Claude asks the app before a risky tool runs. Verified with Claude Code 2.1.292:
// stream-json on stdin plus `--permission-prompt-tool stdio` makes Claude send `control_request` (`can_use_tool`)
// lines and wait for a `control_response`. The flag is hidden from `--help`; the other modes never use it.
const HOST_ARGS = ['--input-format', 'stream-json', '--permission-prompt-tool', 'stdio'];
const HOST_UNSUPPORTED_HINT = ' This Claude version cannot ask for permission through the app: pick Accept edits or Bypass perms in the footer, or update Claude Code.';
const DEFAULT_PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

// An unanswered request is denied after this long. CBH_PERMISSION_TIMEOUT_MS is a test seam: read here, in the
// main process only (never from settings or the renderer); values below 500 are ignored.
function permissionTimeoutMs() {
  const fromEnv = Number(process.env.CBH_PERMISSION_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv >= 500 ? fromEnv : DEFAULT_PERMISSION_TIMEOUT_MS;
}

/**
 * @param {object} opts
 * @param {string} opts.prompt
 * @param {string} opts.cwd
 * @param {string|null} opts.sessionId  resume this session if set
 * @param {string} opts.permissionMode
 * @param {'plain'|'host'} [opts.promptMode]  'host' = Claude asks the app for permission (see HOST_ARGS); default 'plain'
 * @param {(event: object) => void} emit
 * @returns {{cancel: function, running: boolean, answerPermission: function, pendingPermissions: function}} handle
 */
function run({ prompt, cwd, sessionId, permissionMode, model, agent, promptMode = 'plain' }, emit) {
  const host = promptMode === 'host';
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', permissionMode || 'default',
  ];
  if (sessionId) args.push('--resume', sessionId);
  if (model) args.push('--model', model);
  // Run as a named agent from .claude/agents (the caller has already validated the name).
  if (agent && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(agent)) args.push('--agent', agent);
  if (host) args.push(...HOST_ARGS);

  const bin = resolveClaudeBinary();
  emit({ type: 'start' });

  let child = null;
  // Requests Claude is waiting on (host mode). The broker is the only thing that can say "allow".
  const broker = host ? permissions.createBroker({
    timeoutMs: permissionTimeoutMs(),
    onTimeout: ({ requestId, response }) => {
      const wrote = writeLine(permissions.buildControlResponse(requestId, response));
      emit({ type: 'permission-resolved', requestId, how: wrote ? 'timeout' : 'ended' });
    },
  }) : null;
  const writeLine = (line) => {
    const stdin = child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return false;
    try { stdin.write(line); return true; } catch { return false; }
  };
  const endInput = () => { try { if (child?.stdin && !child.stdin.destroyed) child.stdin.end(); } catch { /* already closed */ } };
  // Anything still pending when the process is over can never be answered.
  const dropPending = () => {
    if (!broker) return;
    for (const requestId of broker.clear()) emit({ type: 'permission-resolved', requestId, how: 'ended' });
  };
  // 'end' must be emitted exactly once: the renderer stays "busy" until it
  // arrives, and a spawn failure may fire 'error' without 'close'.
  const finish = (code) => {
    if (!handle.running) return;
    handle.running = false;
    dropPending();
    emit({ type: 'end', code });
  };
  const handle = {
    running: true,
    cancel() {
      if (!child || !handle.running) return;
      handle.denyPending();
      if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
      else child.kill('SIGINT');
      if (host) endInput();
    },
    /** The user's answer to a pending request. False when it is not pending in THIS run (unknown, repeated, forged). */
    answerPermission(requestId, decision) {
      if (!broker || !handle.running) return false;
      const answer = broker.answer(requestId, decision);
      if (!answer.ok) return false;
      const wrote = writeLine(permissions.buildControlResponse(requestId, answer.response));
      emit({ type: 'permission-resolved', requestId, how: !wrote ? 'ended' : decision === 'allow' ? 'allowed' : 'denied' });
      return wrote;
    },
    pendingPermissions() {
      return broker ? broker.pending() : [];
    },
    /** Denies every pending request but lets the run go on (nobody can see the cards any more). */
    denyPending() {
      if (!broker || !handle.running) return;
      for (const { requestId, response } of broker.denyAll('stopped')) {
        writeLine(permissions.buildControlResponse(requestId, response));
        emit({ type: 'permission-resolved', requestId, how: 'stopped' });
      }
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
  // Prompt goes over stdin so quoting and length are never an issue. In host mode the pipe stays open (Claude
  // needs it for the answers) until the `result` event; closing it early makes Claude finish without asking.
  if (host) writeLine(permissions.buildUserLine(prompt));
  else child.stdin.end(prompt);

  let buffer = '';
  let stderr = '';
  const state = { streamedText: false, subagents: new Map() };
  let sawSession = false;

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'system' && msg.subtype === 'init') sawSession = true;
        if (host && (msg.type === 'control_request' || msg.type === 'control_cancel_request')) handleControl(msg, { broker, emit, writeLine });
        else handleMessage(msg, emit, state);
        if (host && msg.type === 'result') { dropPending(); endInput(); }
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
    if (code !== 0 && stderr.trim() && handle.running) {
      // A Claude that does not know the host flags says so before it starts any session.
      const unsupported = host && !sawSession && /unknown option|invalid.*--permission|--permission-prompt-tool/i.test(stderr);
      emit({ type: 'error', message: stderr.trim() + (unsupported ? HOST_UNSUPPORTED_HINT : '') });
    }
    finish(code);
  });

  return handle;
}

/**
 * Claude's `control_request` lines in host mode. `can_use_tool` becomes a 'permission' event (or is answered at once
 * for tools that need a conversation the app cannot show); anything else is answered "unsupported" so Claude never waits.
 */
function handleControl(msg, { broker, emit, writeLine }) {
  if (msg.type === 'control_cancel_request') {
    const gone = broker.cancel(msg.request_id);
    if (gone.ok) emit({ type: 'permission-resolved', requestId: msg.request_id, how: 'cancelled' });
    return;
  }
  const requestId = msg.request_id;
  if (typeof requestId !== 'string' || !requestId) return;
  const request = msg.request;
  if (request?.subtype !== 'can_use_tool') {
    writeLine(permissions.buildErrorResponse(requestId, 'unsupported'));
    return;
  }
  if (permissions.isInteractiveOnly(request)) {
    writeLine(permissions.buildControlResponse(requestId, broker.denial('interactive')));
    return;
  }
  const added = broker.add(msg);
  if (added.ok) emit({ type: 'permission', ...added.view });
  else if (added.reason === 'full') writeLine(permissions.buildControlResponse(requestId, broker.denial('full')));
}

// Claude's own delegations: its Agent tool (called Task in older versions) with a `subagent_type`.
const DELEGATE_TOOLS = new Set(['Agent', 'Task']);
const MAX_DELEGATE_TEXT = 4000;

const cap = (value, max) => {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

/** The text of a tool_result block (a string, or a list of text blocks). */
function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c?.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n');
}

/**
 * A finished subagent's tool_result arrives wrapped: a "[Subagent hand-back]" header, the report
 * indented by two spaces, then "agentId: ..." and a <usage> line. Keep just the report.
 */
function subagentReport(raw) {
  let text = raw;
  const marker = 'The report follows:';
  const at = text.indexOf(marker);
  if (at !== -1) {
    text = text.slice(at + marker.length).replace(/^\n/, '');
    text = text.replace(/\nagentId:[\s\S]*$/, '').replace(/^ {2}/gm, '');
  }
  return cap(text, MAX_DELEGATE_TEXT);
}

/** Emits the end of a delegation once; later signals for the same call are ignored. */
function endSubagent(state, emit, toolUseId, isError, text) {
  const record = state.subagents.get(toolUseId);
  if (!record || record.ended) return;
  record.ended = true;
  emit({ type: 'subagent', phase: 'end', toolUseId, isError, text });
}

// `state.streamedText` tells an assistant message whose text already arrived as deltas apart from
// one that did not: built-in commands (/context, /usage...) answer with a complete message and no deltas.
// Messages with `parent_tool_use_id` were produced inside a subagent (the Agent call with that id).
function handleMessage(msg, emit, state) {
  const inner = typeof msg.parent_tool_use_id === 'string' ? msg.parent_tool_use_id : null;
  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init') emit({ type: 'session', sessionId: msg.session_id, model: msg.model });
      // A background agent's result only arrives as a notification (its tool_result is a launch notice).
      else if (msg.subtype === 'task_notification' && state.subagents.get(msg.tool_use_id)?.background) {
        endSubagent(state, emit, msg.tool_use_id, msg.status !== 'completed', cap(msg.summary, MAX_DELEGATE_TEXT));
      }
      break;

    case 'stream_event': {
      if (inner) break; // a subagent's own model calls are not the chat's text, thinking or tokens
      const ev = msg.event;
      // One message_delta per model call, carrying that call's final usage.
      if (ev?.type === 'message_start' && ev.message?.usage) {
        // Start of a model call: input and cache tokens are already known.
        emit({ type: 'turn', usage: normalizeUsage(ev.message.usage) });
      } else if (ev?.type === 'message_delta' && ev.usage) {
        emit({ type: 'usage', usage: normalizeUsage(ev.usage) });
      } else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        state.streamedText = true;
        emit({ type: 'text', text: ev.delta.text });
      } else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') {
        emit({ type: 'thinking', text: ev.delta.thinking });
      } else if (ev?.type === 'content_block_start' && ev.content_block?.type === 'thinking') {
        emit({ type: 'thinking' });
      }
      break;
    }

    case 'assistant':
      if (inner) {
        // Work inside a subagent: sent to that subagent, not as the chat's own tool lines and text.
        for (const block of msg.message?.content || []) {
          if (block.type === 'tool_use') {
            emit({ type: 'subagent', phase: 'event', toolUseId: inner, inner: 'tool', name: block.name, summary: summarizeToolInput(block.input) });
          } else if (block.type === 'text' && block.text) {
            emit({ type: 'subagent', phase: 'event', toolUseId: inner, inner: 'text', text: block.text });
          }
        }
        break;
      }
      // Normal replies already arrived as deltas, so only tool calls are picked out here;
      // text is emitted only when nothing was streamed (command output).
      for (const block of msg.message?.content || []) {
        if (block.type === 'tool_use') {
          emit({ type: 'tool', name: block.name, summary: summarizeToolInput(block.input) });
          if (DELEGATE_TOOLS.has(block.name) && typeof block.input?.subagent_type === 'string' && typeof block.id === 'string') {
            state.subagents.set(block.id, { background: false, ended: false });
            emit({
              type: 'subagent', phase: 'start', toolUseId: block.id,
              agentType: cap(block.input.subagent_type, 100),
              description: cap(block.input.description, 200),
              prompt: cap(block.input.prompt, MAX_DELEGATE_TEXT),
            });
          }
        } else if (block.type === 'text' && block.text && !state.streamedText) {
          emit({ type: 'text', text: block.text });
        }
      }
      state.streamedText = false;
      break;

    case 'user':
      // Only the chat's own tool results matter: the answer to a delegation ends it.
      if (inner || !Array.isArray(msg.message?.content)) break;
      for (const block of msg.message.content) {
        if (block.type !== 'tool_result') continue;
        const record = state.subagents.get(block.tool_use_id);
        if (!record) continue;
        if (msg.tool_use_result?.isAsync) record.background = true; // launch notice; the result comes later
        else endSubagent(state, emit, block.tool_use_id, !!block.is_error, subagentReport(resultText(block.content)));
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

/**
 * The slash commands Claude itself recognises in headless mode, as [{ name, description, argumentHint }],
 * or null if they could not be read. Uses Claude's own `initialize` request: no model call, no session.
 */
function listCommands(cwd, timeoutMs = 6000) {
  return new Promise((resolve) => {
    let child;
    let settled = false;
    let buffer = '';
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (child?.pid) {
          if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
          else child.kill('SIGTERM');
        }
      } catch { /* already gone */ }
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    try {
      child = spawn(resolveClaudeBinary(), ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose'], {
        cwd, env: childEnv(), shell: isWin,
      });
    } catch {
      done(null);
      return;
    }
    child.on('error', () => done(null));
    child.on('close', () => done(null));
    child.stderr.resume(); // drain it so a chatty child can't block
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'control_response' && msg.response?.request_id === 'cmd-list') {
            const commands = msg.response?.response?.commands;
            done(Array.isArray(commands)
              ? commands.map((c) => ({ name: c.name, description: c.description || '', argumentHint: c.argumentHint || '' }))
              : null);
            return;
          }
        } catch { /* not JSON */ }
      }
    });
    child.stdin.on('error', () => done(null));
    child.stdin.write(`${JSON.stringify({ type: 'control_request', request_id: 'cmd-list', request: { subtype: 'initialize' } })}\n`);
  });
}

const ASK_MAX_OUTPUT = 64 * 1024;

/**
 * One-shot question to Claude with no tools and no saved session (used to design a summoned hero).
 * Resolves, never rejects: `{ ok: true, text }` or `{ ok: false, error: 'timeout' | 'not-found' | 'failed' | 'too-large' }`.
 * `cwd` should be a neutral folder, never a project, so no project files or settings are loaded.
 */
function ask({ prompt, cwd, model, timeoutMs = 25000 }) {
  return new Promise((resolve) => {
    let child;
    let settled = false;
    let out = '';
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (child?.pid) {
          if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
          else child.kill('SIGTERM');
        }
      } catch { /* already gone */ }
      resolve(value);
    };
    const timer = setTimeout(() => done({ ok: false, error: 'timeout' }), timeoutMs);
    const args = ['-p', '--output-format', 'json', '--tools', '', '--max-turns', '1', '--no-session-persistence',
      '--disable-slash-commands', '--permission-mode', 'default'];
    if (model) args.push('--model', model);
    try {
      child = spawn(resolveClaudeBinary(), args, { cwd, env: childEnv(), shell: isWin });
    } catch {
      done({ ok: false, error: 'not-found' });
      return;
    }
    child.on('error', (err) => done({ ok: false, error: err.code === 'ENOENT' ? 'not-found' : 'failed' }));
    child.stderr.resume();
    child.stdout.on('data', (chunk) => {
      out += chunk.toString();
      if (out.length > ASK_MAX_OUTPUT) done({ ok: false, error: 'too-large' });
    });
    child.on('close', () => {
      try {
        const msg = JSON.parse(out.trim().split('\n').pop() || '');
        if (msg && msg.is_error !== true && typeof msg.result === 'string') done({ ok: true, text: msg.result });
        else done({ ok: false, error: 'failed' });
      } catch {
        done({ ok: false, error: 'failed' });
      }
    });
    child.stdin.on('error', () => done({ ok: false, error: 'failed' }));
    child.stdin.end(prompt);
  });
}

module.exports = { run, resolveClaudeBinary, listCommands, ask };
