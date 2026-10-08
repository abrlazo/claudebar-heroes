// Archive of retired or closed agent chats, kept per project in settings.json (workspace.archive).
// Pure functions, no electron import, so tools/check-archive.mjs can require this file.
//
// The renderer owns the live logs and sends a record when an agent is retired. Nothing it sends is
// trusted: cleanArchived builds a NEW object from an allowlist, clamps every size and checks every enum.

const MAX_ARCHIVED = 20; // chats per project, the oldest are dropped
const MAX_ARCHIVE_MESSAGES = 200; // messages per chat (the first one, the task, is always kept)
const MAX_MESSAGE_CHARS = 4000; // characters per message text
const MAX_CHAT_CHARS = 40000; // characters per chat in total
const MAX_INPUT_MESSAGES = 1000; // looked at per chat before the caps (cheap cut for hostile input)
const NUMBER_CAP = 1e12;

const STATUSES = ['done', 'error', 'cancelled'];
const REASONS = ['idle', 'closed'];
const TEXT_KINDS = ['user', 'assistant', 'error', 'meta', 'thinking'];
const ID_PATTERN = /^[\w:.-]{1,100}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.min(v, NUMBER_CAP) : 0);

// One chat message rebuilt by kind, or null when it is not a known shape.
function cleanMessage(raw) {
  if (!isObject(raw)) return null;
  if (raw.kind === 'tool') {
    const msg = { kind: 'tool', name: str(raw.name, 80) || 'tool' };
    if (typeof raw.summary === 'string' && raw.summary) msg.summary = raw.summary.slice(0, 300);
    return msg;
  }
  if (TEXT_KINDS.includes(raw.kind)) return { kind: raw.kind, text: str(raw.text, MAX_MESSAGE_CHARS) };
  return null;
}

const sizeOf = (m) => (m.kind === 'tool' ? m.name.length + (m.summary ? m.summary.length : 0) : m.text.length);

// Keeps the first message (the task) and as many of the newest as fit the count and size caps,
// with one meta line where the middle was left out.
function capMessages(list, skipped) {
  if (list.length === 0) return list;
  // Already within the caps (also what a stored chat looks like after an earlier cut): keep it as it is.
  if (skipped === 0 && list.length <= MAX_ARCHIVE_MESSAGES && list.reduce((n, m) => n + sizeOf(m), 0) <= MAX_CHAT_CHARS) return list;
  const head = list[0];
  let chars = sizeOf(head);
  const tail = [];
  let kept = 1;
  for (let i = list.length - 1; i >= 1; i--) {
    const size = sizeOf(list[i]);
    // One slot stays free for the "omitted" line while something is left out.
    if (kept + 1 >= MAX_ARCHIVE_MESSAGES || chars + size > MAX_CHAT_CHARS) break;
    tail.push(list[i]);
    kept += 1;
    chars += size;
  }
  tail.reverse();
  const omitted = skipped + list.length - 1 - tail.length;
  if (omitted <= 0) return [head, ...tail];
  const note = { kind: 'meta', text: `${omitted} earlier message${omitted === 1 ? '' : 's'} omitted` };
  return [head, note, ...tail];
}

// A clean archived chat, or null when `raw` is unusable. Extra properties are ignored.
function cleanArchived(raw) {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) return null;
  if (!STATUSES.includes(raw.status) || !REASONS.includes(raw.reason)) return null;
  const input = Array.isArray(raw.messages) ? raw.messages : [];
  // Cheap cut first: the task plus the newest ones.
  const window = input.length > MAX_INPUT_MESSAGES ? [input[0], ...input.slice(-(MAX_INPUT_MESSAGES - 1))] : input;
  const messages = window.map(cleanMessage).filter(Boolean);
  const usage = isObject(raw.usage) ? raw.usage : {};
  return {
    id: raw.id,
    name: str(raw.name, 40),
    definition: str(raw.definition, 60),
    task: str(raw.task, 500),
    observed: raw.observed === true,
    status: raw.status,
    reason: raw.reason,
    startedAt: num(raw.startedAt),
    endedAt: Number.isFinite(raw.endedAt) && raw.endedAt >= 0 ? Math.min(raw.endedAt, NUMBER_CAP) : null,
    archivedAt: num(raw.archivedAt),
    usage: { input: num(usage.input), output: num(usage.output), cacheRead: num(usage.cacheRead), cacheCreate: num(usage.cacheCreate) },
    sessionId: typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId.slice(0, 100) : null,
    messages: capMessages(messages, input.length - window.length),
  };
}

// A whole stored list: unusable entries dropped, repeated ids keep the newest, at most MAX_ARCHIVED (newest last).
function cleanArchive(list) {
  if (!Array.isArray(list)) return [];
  const byId = new Map();
  for (const raw of list.slice(-MAX_ARCHIVED * 2)) {
    const rec = cleanArchived(raw);
    if (!rec) continue;
    byId.delete(rec.id);
    byId.set(rec.id, rec);
  }
  return [...byId.values()].slice(-MAX_ARCHIVED);
}

module.exports = {
  MAX_ARCHIVED, MAX_ARCHIVE_MESSAGES, MAX_MESSAGE_CHARS, MAX_CHAT_CHARS, cleanArchived, cleanArchive,
};
