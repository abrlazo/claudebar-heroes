// Chat image attachments: validation, the staging store and the cleaning of saved thumbnails.
// Pure functions, no electron import, so tools/check-images.mjs can require this file.
//
// Bytes cross IPC once, when the user attaches (`images:stage`). Main sniffs the type from the magic
// bytes, reads the size from the header (before any decode), keeps the bytes in memory and hands the
// renderer an opaque id plus a small thumbnail main made. A send carries only ids. Nothing the renderer
// says about a type, name or path is ever read.

const crypto = require('node:crypto');

const MAX_IMAGES = 5; // per message
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024; // raw bytes per image (stays under 5 MB as base64)
const MAX_TOTAL_BYTES = 10 * 1024 * 1024; // raw bytes per message
const MAX_SIDE = 8000; // pixels per side
const MAX_PIXELS = 40e6;
const MAX_THUMB_CHARS = 6000;
const MAX_THUMB_MESSAGES = 12; // chat messages that keep their thumbnails (the newest)
const STAGE_MAX_ITEMS = 20;
const STAGE_MAX_BYTES = 40 * 1024 * 1024;
const STAGE_TTL_MS = 30 * 60 * 1000;
const MAX_ID_CHARS = 100;

const THUMB_PATTERN = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Fixed texts per refusal code. Nothing from the file ever reaches them.
const MESSAGES = {
  type: 'Only PNG, JPEG, GIF and WebP images can be attached.',
  'too-big': 'That image is larger than 3.5 MB.',
  'too-large-dimensions': 'That image has too many pixels (at most 8000 per side).',
  unreadable: 'That image could not be read.',
  'too-many': 'Too many images are waiting. Send or remove some first.',
  busy: 'Too much image data is waiting. Send or remove some first.',
};

const ascii = (buf, from, to) => buf.toString('latin1', from, to);

/** 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' from the magic bytes, else null. */
function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && ascii(buf, 1, 4) === 'PNG' && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const head = ascii(buf, 0, 6);
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function jpegSize(buf) {
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xff) { i++; continue; }
    // Markers without a length: TEM, RSTn, SOI, EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 9 > buf.length) return null;
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

function webpSize(buf) {
  if (buf.length < 30) return null;
  const kind = ascii(buf, 12, 16);
  if (kind === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >>> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X') {
    return { width: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1, height: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1 };
  }
  return null;
}

/** `{ width, height }` read from the header of an image of a type `sniff` knows, or null. */
function readSize(buf, mime = sniff(buf)) {
  try {
    if (mime === 'image/png') return buf.length >= 24 && ascii(buf, 12, 16) === 'IHDR' ? { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } : null;
    if (mime === 'image/gif') return buf.length >= 10 ? { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) } : null;
    if (mime === 'image/jpeg') return jpegSize(buf);
    if (mime === 'image/webp') return webpSize(buf);
  } catch { /* a short buffer: unreadable */ }
  return null;
}

/** `{ ok:true, mime, width, height }` or `{ ok:false, code }`. Looks at the bytes only. */
function validateImage(buf) {
  if (!Buffer.isBuffer(buf)) return { ok: false, code: 'unreadable' };
  if (buf.length > MAX_IMAGE_BYTES) return { ok: false, code: 'too-big' };
  const mime = sniff(buf);
  if (!mime) return { ok: false, code: 'type' };
  const size = readSize(buf, mime);
  if (!size || !(size.width > 0) || !(size.height > 0)) return { ok: false, code: 'unreadable' };
  if (size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS) return { ok: false, code: 'too-large-dimensions' };
  return { ok: true, mime, width: size.width, height: size.height };
}

/** Checks the images of ONE message (`[{ buffer }]`): a code or null. */
function validateBatch(items) {
  if (!Array.isArray(items) || items.length > MAX_IMAGES) return 'too-many';
  let total = 0;
  for (const it of items) total += it.buffer.length;
  return total > MAX_TOTAL_BYTES ? 'too-big' : null;
}

/** A thumbnail data URL kept only when it has the exact shape and size we store. */
const goodThumb = (t) => typeof t === 'string' && t.length <= MAX_THUMB_CHARS && THUMB_PATTERN.test(t);

/** `[{ thumb }]` rebuilt from an allowlist: at most 5, plain objects, jpeg data URLs under the cap. */
function cleanImages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const it of raw.slice(0, MAX_IMAGES)) {
    if (isObject(it) && goodThumb(it.thumb)) out.push({ thumb: it.thumb });
  }
  return out;
}

const countOf = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(MAX_IMAGES, Math.floor(v))) : 0);

/** A message with its image fields cleaned: only a user message may have them. Returns a new object. */
function cleanMessageImages(msg) {
  if (!isObject(msg)) return msg;
  const out = { ...msg };
  delete out.images;
  delete out.imageCount;
  if (msg.kind !== 'user') return out;
  const images = cleanImages(msg.images);
  if (images.length) out.images = images;
  else if (countOf(msg.imageCount) > 0) out.imageCount = countOf(msg.imageCount);
  return out;
}

/** Keeps thumbnails only on the newest `keep` image messages; older ones become `{ imageCount }`. In place. */
function trimOldThumbs(messages, keep = MAX_THUMB_MESSAGES) {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!isObject(m) || !Array.isArray(m.images)) continue;
    seen += 1;
    if (seen > keep) {
      const n = m.images.length;
      messages[i] = { ...m, imageCount: n };
      delete messages[i].images;
    }
  }
  return messages;
}

/** The in-memory store of staged images. `now` is injected for tests. */
function createStaging({ maxItems = STAGE_MAX_ITEMS, maxBytes = STAGE_MAX_BYTES, ttlMs = STAGE_TTL_MS, now = Date.now } = {}) {
  const items = new Map(); // id -> { mime, buffer, thumb, at }
  let bytes = 0;

  function drop(id) {
    const it = items.get(id);
    if (!it) return;
    bytes -= it.buffer.length;
    items.delete(id);
  }
  function sweep() {
    const t = now();
    for (const [id, it] of items) if (t - it.at > ttlMs) drop(id);
  }
  return {
    /** `{ ok:true, id }` or `{ ok:false, code }`. */
    add({ mime, buffer, thumb }) {
      sweep();
      if (items.size >= maxItems) return { ok: false, code: 'too-many' };
      if (bytes + buffer.length > maxBytes) return { ok: false, code: 'busy' };
      const id = crypto.randomUUID();
      items.set(id, { mime, buffer, thumb, at: now() });
      bytes += buffer.length;
      return { ok: true, id };
    },
    /** True when every id is staged (and the list is a list of unique plain strings). Does not consume. */
    has(ids) {
      sweep();
      return validIds(ids) && ids.every((id) => items.has(id));
    },
    /** Consumes the ids: `[{ mime, buffer, thumb }]` in order, or null when anything is wrong (then nothing is taken). */
    take(ids) {
      sweep();
      if (!validIds(ids) || !ids.every((id) => items.has(id))) return null;
      const out = ids.map((id) => { const { mime, buffer, thumb } = items.get(id); return { mime, buffer, thumb }; });
      ids.forEach(drop);
      return out;
    },
    discard(ids) {
      if (!Array.isArray(ids)) return;
      for (const id of ids.slice(0, MAX_IMAGES)) if (typeof id === 'string') drop(id);
    },
    sweep,
    clear() { items.clear(); bytes = 0; },
    get size() { return items.size; },
    get bytes() { return bytes; },
  };
}

/** A list of 1..5 unique strings of at most 100 characters. */
function validIds(ids) {
  return Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_IMAGES
    && ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_CHARS)
    && new Set(ids).size === ids.length;
}

module.exports = {
  MAX_IMAGES, MAX_IMAGE_BYTES, MAX_TOTAL_BYTES, MAX_SIDE, MAX_PIXELS, MAX_THUMB_CHARS, MAX_THUMB_MESSAGES, MESSAGES,
  sniff, readSize, validateImage, validateBatch, validIds, createStaging, cleanImages, cleanMessageImages, trimOldThumbs, goodThumb,
};
