// Archive of retired or closed agent chats, kept per project in settings.json (workspace.archive).
// Pure functions, no electron import, so tools/check-archive.mjs can require this file.
//
// The renderer owns the live logs and sends a record when an agent is retired. Nothing it sends is
// trusted: cleanArchived builds a NEW object from an allowlist, clamps every size and checks every enum.

const MAX_ARCHIVED = 20; // chats per project, the oldest are dropped
const MAX_ARCHIVE_MESSAGES = 200; // messages per chat (the first one, the task, is always kept)
const MAX_MESSAGE_CHARS = 4000; // characters per message text
const MAX_CHAT_CHARS = 40000; // characters per chat in total
const MAX_IMAGE_COUNT = 5; // an archived message only remembers how many images it had
const MAX_INPUT_MESSAGES = 1000; // looked at per chat before the caps (cheap cut for hostile input)
const NUMBER_CAP = 1e12; // token counts
const TIME_CAP = 8.64e15; // the largest time a JS Date can hold; real timestamps (about 1.8e12) must pass through
// Before this fix times were clamped to NUMBER_CAP (1e12 = 2001-09-09), so every stored time reads the same.
// That value cannot be a real time of an agent run, so it is treated as "unknown" (0, or null for endedAt).
const LOST_TIME = NUMBER_CAP;

const STATUSES = ['done', 'error', 'cancelled'];
const REASONS = ['idle', 'closed', 'new-session'];
const SOURCES = ['agent', 'quest'];
const TEXT_KINDS = ['user', 'assistant', 'error', 'meta', 'thinking'];
const ID_PATTERN = /^[\w:.-]{1,100}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.min(v, NUMBER_CAP) : 0);
const time = (v) => (Number.isFinite(v) && v > 0 && v !== LOST_TIME ? Math.min(v, TIME_CAP) : 0);

// One chat message rebuilt by kind, or null when it is not a known shape.
function cleanMessage(raw) {
  if (!isObject(raw)) return null;
  if (raw.kind === 'tool') {
    const msg = { kind: 'tool', name: str(raw.name, 80) || 'tool' };
    if (typeof raw.summary === 'string' && raw.summary) msg.summary = raw.summary.slice(0, 300);
    return msg;
  }
  if (TEXT_KINDS.includes(raw.kind)) {
    const msg = { kind: raw.kind, text: str(raw.text, MAX_MESSAGE_CHARS) };
    // Images are never archived: only how many there were (from the thumbnails or an earlier count).
    if (raw.kind === 'user') {
      const n = Array.isArray(raw.images) ? raw.images.length : raw.imageCount;
      const count = Number.isFinite(n) ? Math.max(0, Math.min(MAX_IMAGE_COUNT, Math.floor(n))) : 0;
      if (count > 0) msg.imageCount = count;
    }
    return msg;
  }
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
  // A Quest record only comes from New session (main builds it); the two always go together.
  if (raw.reason === 'new-session' && raw.source !== 'quest') return null;
  const source = raw.source === 'quest' && raw.reason === 'new-session' ? 'quest' : 'agent';
  const input = Array.isArray(raw.messages) ? raw.messages : [];
  // Cheap cut first: the task plus the newest ones.
  const window = input.length > MAX_INPUT_MESSAGES ? [input[0], ...input.slice(-(MAX_INPUT_MESSAGES - 1))] : input;
  const messages = window.map(cleanMessage).filter(Boolean);
  const usage = isObject(raw.usage) ? raw.usage : {};
  const rec = {
    id: raw.id,
    source,
    name: str(raw.name, 40),
    definition: str(raw.definition, 60),
    task: str(raw.task, 500),
    observed: raw.observed === true,
    status: raw.status,
    reason: raw.reason,
    startedAt: time(raw.startedAt),
    endedAt: time(raw.endedAt) || null,
    archivedAt: time(raw.archivedAt),
    usage: { input: num(usage.input), output: num(usage.output), cacheRead: num(usage.cacheRead), cacheCreate: num(usage.cacheCreate) },
    sessionId: typeof raw.sessionId === 'string' && raw.sessionId ? raw.sessionId.slice(0, 100) : null,
    messages: capMessages(messages, input.length - window.length),
  };
  // Only a Quest chat can be restored, so only it remembers how full its context was.
  if (source === 'quest') rec.lastContext = num(raw.lastContext);
  return rec;
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

// The Quest chat of a workspace as an archive record (cleanArchived still has the last word), or null when it
// has no user or assistant message worth keeping. workspace.usage is a lifetime total, so usage stays zero;
// chat messages have no timestamps, so startedAt is unknown (0).
function buildQuestRecord(ws, now = Date.now()) {
  const messages = ws && Array.isArray(ws.messages) ? ws.messages : [];
  const firstUser = messages.find((m) => isObject(m) && m.kind === 'user');
  if (!messages.some((m) => isObject(m) && (m.kind === 'user' || m.kind === 'assistant'))) return null;
  const d = new Date(now);
  const text = firstUser && typeof firstUser.text === 'string' ? firstUser.text.trim() : '';
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return {
    id: `quest-${now}-${rand}`,
    source: 'quest',
    name: `Quest ${MONTHS[d.getMonth()]} ${d.getDate()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`,
    definition: '',
    task: text ? text.slice(0, 500) : firstUser ? '(images)' : '',
    observed: false,
    status: 'done',
    reason: 'new-session',
    startedAt: 0,
    endedAt: now,
    archivedAt: now,
    usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    sessionId: typeof ws.sessionId === 'string' ? ws.sessionId : null,
    lastContext: Number.isFinite(ws.lastContext) ? ws.lastContext : 0,
    messages,
  };
}

// Restore: an archived Quest chat becomes the workspace's chat and the current chat takes its place in the
// archive. Returns the workspace patch { sessionId, messages, lastContext, archive } or null (unknown id, an
// agent record). The record is looked up in main's own copy; the restored one leaves first, so the list never grows.
function swapQuest(ws, id, now = Date.now()) {
  if (!ws || typeof id !== 'string') return null;
  const archive = cleanArchive(ws.archive);
  const rec = archive.find((r) => r.id === id && r.source === 'quest');
  if (!rec) return null;
  const current = cleanArchived(buildQuestRecord(ws, now));
  const next = archive.filter((r) => r.id !== id);
  if (current) next.push(current);
  return {
    sessionId: rec.sessionId,
    messages: rec.messages.map((m) => ({ ...m })),
    lastContext: rec.lastContext || 0,
    archive: next.slice(-MAX_ARCHIVED),
  };
}

module.exports = {
  buildQuestRecord, swapQuest, MAX_ARCHIVED, MAX_ARCHIVE_MESSAGES, MAX_MESSAGE_CHARS, MAX_CHAT_CHARS, cleanArchived, cleanArchive,
};
