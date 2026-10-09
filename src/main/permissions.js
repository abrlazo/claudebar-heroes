// Permission prompts ("Ask me each time"): the pure part. No electron import, so tools/check-permissions.mjs
// can load it. Claude (started with `--permission-prompt-tool stdio`) sends a `control_request` with
// subtype `can_use_tool` and waits for a `control_response` on stdin. A broker per run remembers what
// main itself saw pending: the renderer can only say "allow" or "deny" for a request id that is in there,
// and an allow always carries the tool input main stored, never anything the renderer sent.

const MAX_PENDING = 20;
const MAX_ID_LENGTH = 100;
const INTERACTIVE_TOOLS = new Set(['AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode']);

// Text the user sees comes from a model and from files: untrusted. C0/C1 control characters (except
// newline and tab), bidi overrides/isolates and zero-width characters are removed before display.
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000d-\u001f\u007f-\u009f]/g;
const INVISIBLE_RE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

/** A string safe to show: control and bidi characters removed, line breaks normalised, capped with "...". */
function sanitizeText(value, maxChars) {
  if (typeof value !== 'string') return '';
  // Cut before the regexes run, so a huge string costs little.
  const limit = Math.max(4, maxChars | 0);
  const clipped = value.length > limit * 2 + 16;
  const head = clipped ? value.slice(0, limit * 2 + 16) : value;
  const clean = head.replace(/\r\n?/g, '\n').replace(CONTROL_RE, '').replace(INVISIBLE_RE, '');
  if (!clipped && clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 3)}...`;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** First `maxLines` lines of `text` (each capped), and how many lines were left out. */
function takeLines(text, maxLines, maxLineChars) {
  const all = text.split('\n');
  const shown = all.slice(0, maxLines).map((line) => sanitizeText(line, maxLineChars));
  return { text: shown.join('\n'), left: Math.max(0, all.length - shown.length), cut: shown.some((l, i) => l.endsWith('...') && all[i].length > maxLineChars) };
}

const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/**
 * What the card shows for a `can_use_tool` request: `{ tool, summary, detail, truncatedLines, truncated,
 * path, viaSubagent }`. Every string is sanitised and capped; it never throws on odd input.
 */
function describeRequest(request) {
  const req = isObject(request) ? request : {};
  const input = isObject(req.input) ? req.input : {};
  const rawName = typeof req.display_name === 'string' && req.display_name ? req.display_name : req.tool_name;
  const tool = sanitizeText(typeof rawName === 'string' ? rawName : 'tool', 60) || 'tool';
  const name = typeof req.tool_name === 'string' ? req.tool_name : '';
  let summary = '';
  let detail = '';
  let truncatedLines = 0;
  let truncated = false;
  let path = '';

  if (name === 'Bash' && typeof input.command === 'string') {
    const full = sanitizeText(input.command, 4000);
    const lines = takeLines(full, 40, 400);
    detail = lines.text;
    truncatedLines = lines.left;
    truncated = input.command.length > 4000 || lines.cut;
    summary = sanitizeText(full.split('\n')[0], 120);
  } else if (FILE_TOOLS.has(name)) {
    const file = input.file_path ?? input.notebook_path;
    path = sanitizeText(typeof file === 'string' ? file : '', 500);
    const body = [input.content, input.new_string, input.new_source].find((v) => typeof v === 'string') ?? '';
    const lines = takeLines(body, 12, 200);
    detail = lines.text;
    truncatedLines = lines.left;
    truncated = lines.cut;
    summary = path;
  } else if (name === 'WebFetch' && typeof input.url === 'string') {
    summary = sanitizeText(input.url, 300);
    detail = summary;
  } else {
    let json = '';
    try { json = JSON.stringify(input, null, 2) ?? ''; } catch { json = ''; }
    const capped = sanitizeText(json, 1500);
    truncated = json.length > 1500;
    detail = capped === '{}' ? '' : capped;
    const first = Object.values(input).find((v) => typeof v === 'string');
    summary = sanitizeText(first ?? (typeof req.description === 'string' ? req.description : ''), 120);
  }
  if (!path && typeof req.blocked_path === 'string') path = sanitizeText(req.blocked_path, 500);
  return { tool, summary, detail, truncatedLines, truncated, path, viaSubagent: typeof req.agent_id === 'string' && req.agent_id !== '' };
}

/** Tools that need a real conversation with the user, which this app cannot show: always denied, never asked. */
function isInteractiveOnly(request) {
  return isObject(request) && (request.requires_user_interaction === true || INTERACTIVE_TOOLS.has(request.tool_name));
}

const DENY_MESSAGES = {
  user: 'The user denied this request in Claudebar.',
  timeout: 'No answer in Claudebar within the time limit, so this request was denied.',
  stopped: 'The run was stopped in Claudebar, so this request was denied.',
  interactive: 'This app cannot show that question or plan screen; ask the user in the chat instead.',
  full: 'Too many permission requests are waiting in Claudebar, so this one was denied.',
};

/** One broker per run. Time and timers are injected so the check can drive them by hand. */
function createBroker({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, timeoutMs = 300000, onTimeout = () => {} } = {}) {
  const pendingById = new Map(); // request_id -> { requestId, input, toolUseId, createdAt, expiresAt, timer, view }

  const finish = (requestId) => {
    const entry = pendingById.get(requestId);
    if (!entry) return null;
    pendingById.delete(requestId);
    clearTimer(entry.timer);
    return entry;
  };
  const denial = (reason) => ({ behavior: 'deny', message: DENY_MESSAGES[reason] || DENY_MESSAGES.user });

  return {
    /**
     * Records a can_use_tool control_request. `{ ok: true, view }` (what to show), or `{ ok: false, reason }`:
     * 'invalid' (not a usable request id), 'duplicate' (ignored) or 'full' (the caller denies it).
     */
    add(msg) {
      const requestId = msg?.request_id;
      if (typeof requestId !== 'string' || !requestId || requestId.length > MAX_ID_LENGTH) return { ok: false, reason: 'invalid' };
      if (pendingById.has(requestId)) return { ok: false, reason: 'duplicate' };
      if (pendingById.size >= MAX_PENDING) return { ok: false, reason: 'full' };
      const request = isObject(msg.request) ? msg.request : {};
      const createdAt = now();
      const expiresAt = createdAt + timeoutMs;
      const view = { requestId, ...describeRequest(request), expiresAt };
      const timer = setTimer(() => {
        const entry = finish(requestId);
        if (entry) onTimeout({ requestId, response: denial('timeout'), view: entry.view });
      }, timeoutMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
      pendingById.set(requestId, { requestId, input: isObject(request.input) ? structuredClone(request.input) : {}, toolUseId: request.tool_use_id, createdAt, expiresAt, timer, view });
      return { ok: true, view };
    },
    /** The answer to a pending request, once. `decision` must be exactly 'allow' or 'deny'. */
    answer(requestId, decision) {
      if (decision !== 'allow' && decision !== 'deny') return { ok: false, reason: 'invalid' };
      if (typeof requestId !== 'string' || !pendingById.has(requestId)) return { ok: false, reason: 'unknown' };
      const entry = finish(requestId);
      const response = decision === 'allow' ? { behavior: 'allow', updatedInput: entry.input } : denial('user');
      return { ok: true, response, view: entry.view };
    },
    /** Claude withdrew a request (control_cancel_request). */
    cancel(requestId) {
      const entry = typeof requestId === 'string' ? finish(requestId) : null;
      return entry ? { ok: true, view: entry.view } : { ok: false, reason: 'unknown' };
    },
    /** Denies everything still pending (Stop). Returns each request once. */
    denyAll(reason = 'stopped') {
      return [...pendingById.keys()].map((id) => ({ requestId: id, response: denial(reason), view: finish(id).view }));
    },
    /** Forgets everything without answering (the process is gone). Returns the ids. */
    clear() {
      return [...pendingById.keys()].map((id) => { finish(id); return id; });
    },
    pending() {
      return [...pendingById.values()].map((e) => e.view);
    },
    has: (requestId) => pendingById.has(requestId),
    denial,
  };
}

/** The stdin line that answers a request. */
function buildControlResponse(requestId, response) {
  return `${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })}\n`;
}

/** The stdin line for a control_request this app does not support, so Claude never waits for it. */
function buildErrorResponse(requestId, error) {
  return `${JSON.stringify({ type: 'control_response', response: { subtype: 'error', request_id: requestId, error } })}\n`;
}

/** The stdin line carrying the user's prompt in stream-json input mode. */
function buildUserLine(prompt) {
  return `${JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: String(prompt) }] } })}\n`;
}

module.exports = {
  MAX_PENDING, DENY_MESSAGES, sanitizeText, describeRequest, isInteractiveOnly, createBroker,
  buildControlResponse, buildErrorResponse, buildUserLine,
};
