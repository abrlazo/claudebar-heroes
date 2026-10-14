// Pure checks for chat image attachments (main/images.js) and the renderer's attachment rules
// (renderer/lib/images.ts). Usage: npm run check   (exit code 1 if anything fails)

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const im = createRequire(import.meta.url)(path.join(root, 'src/main/images.js'));

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); };

// ----- tiny image builders (headers only; enough for sniff and readSize) -----
const png = (w = 4, h = 3, pad = 0) => {
  const b = Buffer.alloc(33 + pad);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
};
const gif = (w = 5, h = 6) => { const b = Buffer.alloc(20); b.write('GIF89a', 'latin1'); b.writeUInt16LE(w, 6); b.writeUInt16LE(h, 8); return b; };
const jpeg = (w = 7, h = 8, pad = 0) => {
  const app = Buffer.alloc(2 + 16); app[0] = 0xff; app[1] = 0xe0; app.writeUInt16BE(16, 2);
  const sof = Buffer.alloc(19); sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 8; sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app, sof, Buffer.alloc(pad)]);
};
const webpHead = (kind) => { const b = Buffer.alloc(40); b.write('RIFF', 0, 'latin1'); b.write('WEBP', 8, 'latin1'); b.write(kind, 12, 'latin1'); return b; };
const webpLossy = (w, h) => { const b = webpHead('VP8 '); b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a; b.writeUInt16LE(w, 26); b.writeUInt16LE(h, 28); return b; };
const webpLossless = (w, h) => { const b = webpHead('VP8L'); b[20] = 0x2f; b.writeUInt32LE(((w - 1) | ((h - 1) << 14)) >>> 0, 21); return b; };
const webpExt = (w, h) => { const b = webpHead('VP8X'); b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3); return b; };

// ----- sniff / size / validate -----
check('PNG accepted with its size', (() => { const r = im.validateImage(png(4, 3)); return r.ok && r.mime === 'image/png' && r.width === 4 && r.height === 3; })());
check('JPEG accepted with its size', (() => { const r = im.validateImage(jpeg(7, 8)); return r.ok && r.mime === 'image/jpeg' && r.width === 7 && r.height === 8; })());
check('GIF accepted with its size', (() => { const r = im.validateImage(gif(5, 6)); return r.ok && r.mime === 'image/gif' && r.width === 5 && r.height === 6; })());
check('WebP (lossy, lossless, extended) accepted with sizes', [[webpLossy(10, 20), 10, 20], [webpLossless(30, 40), 30, 40], [webpExt(50, 60), 50, 60]].every(([b, w, h]) => { const r = im.validateImage(b); return r.ok && r.mime === 'image/webp' && r.width === w && r.height === h; }));
check('a text file, an SVG and HTML are refused as type', ['hello world, not an image', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', '<html><body>x</body></html>'].every((t) => im.validateImage(Buffer.from(t)).code === 'type'));
check('BMP and HEIC are refused', im.validateImage(Buffer.concat([Buffer.from('BM'), Buffer.alloc(40)])).code === 'type' && im.validateImage(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(30)])).code === 'type');
check('the type comes from the bytes (a PNG is a PNG whatever it is called)', im.sniff(png()) === 'image/png' && im.sniff(jpeg()) === 'image/jpeg');
check('a truncated header is refused', im.validateImage(png().subarray(0, 18)).ok === false && im.validateImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0, 0, 0, 0, 0, 0])).code === 'unreadable');
check('a JPEG without a frame header is unreadable', im.validateImage(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.from([0xff, 0xe0, 0, 4, 0, 0]), Buffer.alloc(10)])).code === 'unreadable');
check('zero size is refused', im.validateImage(png(0, 5)).code === 'unreadable');
check('not a buffer is refused', [null, 'x', 5, {}, new Uint8Array(30)].every((v) => im.validateImage(v).ok === false));
check('per-image cap', im.validateImage(png(4, 3, im.MAX_IMAGE_BYTES)).code === 'too-big' && im.validateImage(png(4, 3, im.MAX_IMAGE_BYTES - 33)).ok === true);
check('an oversized dimension or pixel count is refused before any decode', im.validateImage(png(8001, 10)).code === 'too-large-dimensions' && im.validateImage(png(7000, 7000)).code === 'too-large-dimensions' && im.validateImage(png(8000, 5000)).ok === true);
check('total cap and the 6th image', im.validateBatch([{ buffer: Buffer.alloc(3e6) }, { buffer: Buffer.alloc(3e6) }, { buffer: Buffer.alloc(3e6) }, { buffer: Buffer.alloc(2e6) }]) === 'too-big'
  && im.validateBatch(Array.from({ length: 6 }, () => ({ buffer: Buffer.alloc(10) }))) === 'too-many'
  && im.validateBatch(Array.from({ length: 5 }, () => ({ buffer: Buffer.alloc(10) }))) === null);
check('every refusal code has a fixed message', ['type', 'too-big', 'too-large-dimensions', 'unreadable', 'too-many', 'busy'].every((c) => typeof im.MESSAGES[c] === 'string'));

// ----- staging -----
const item = (n = 10) => ({ mime: 'image/png', buffer: Buffer.alloc(n), thumb: 'data:image/jpeg;base64,AAAA' });
check('staging: add then take consumes', (() => {
  const s = im.createStaging(); const a = s.add(item()); const b = s.add(item());
  const got = s.take([a.id, b.id]);
  return a.ok && got && got.length === 2 && s.size === 0 && s.bytes === 0 && s.take([a.id]) === null;
})());
check('staging: a repeated, forged or duplicated id fails', (() => {
  const s = im.createStaging(); const a = s.add(item());
  return s.take(['nope']) === null && s.take([a.id, a.id]) === null && s.take([]) === null && s.take('x') === null && s.take([5]) === null && s.size === 1;
})());
check('staging: a partial miss takes nothing', (() => {
  const s = im.createStaging(); const a = s.add(item());
  return s.take([a.id, 'forged']) === null && s.size === 1 && s.take([a.id]) !== null;
})());
check('staging: more than 5 ids is refused', (() => {
  const s = im.createStaging(); const ids = Array.from({ length: 6 }, () => s.add(item()).id);
  return s.take(ids) === null && s.size === 6;
})());
check('staging: item and byte caps', (() => {
  const s = im.createStaging({ maxItems: 2, maxBytes: 100 });
  const a = s.add(item(40)); const b = s.add(item(40)); const c = s.add(item(1));
  s.discard([a.id]);
  const d = s.add(item(70));
  const e = s.add(item(10));
  return a.ok && b.ok && c.code === 'too-many' && d.code === 'busy' && e.ok && s.bytes === 50;
})());
check('staging: TTL with an injected clock', (() => {
  let t = 0; const s = im.createStaging({ ttlMs: 1000, now: () => t });
  const a = s.add(item()); t = 999; const alive = s.has([a.id]); t = 1001;
  return alive && s.take([a.id]) === null && s.size === 0;
})());
check('staging: discard ignores junk and frees bytes', (() => {
  const s = im.createStaging(); const a = s.add(item(25));
  s.discard('x'); s.discard([5, null, 'forged']); const before = s.size;
  s.discard([a.id]);
  return before === 1 && s.size === 0 && s.bytes === 0;
})());

// ----- saved thumbnails -----
const thumb = (n = 20) => `data:image/jpeg;base64,${'A'.repeat(n)}`;
check('cleanImages keeps good jpeg thumbs only', (() => {
  const r = im.cleanImages([{ thumb: thumb() }, { thumb: 'data:image/png;base64,AAAA' }, { thumb: 'javascript:alert(1)' }, { thumb: 'http://x/y.jpg' }, { thumb: thumb(im.MAX_THUMB_CHARS) }, 'x', null, [], { nothumb: 1 }, { thumb: 'data:image/jpeg;base64,AA"onload=x' }]);
  return r.length === 1 && r[0].thumb === thumb();
})());
check('cleanImages: at most 5, extra keys dropped, not a list is empty', (() => {
  const r = im.cleanImages(Array.from({ length: 9 }, () => ({ thumb: thumb(), extra: 1, data: 'x' })));
  return r.length === 5 && r.every((x) => Object.keys(x).join() === 'thumb') && im.cleanImages('x').length === 0 && im.cleanImages(null).length === 0;
})());
check('cleanMessageImages: only user messages keep image fields; imageCount clamps', (() => {
  const a = im.cleanMessageImages({ kind: 'assistant', text: 't', images: [{ thumb: thumb() }], imageCount: 2 });
  const b = im.cleanMessageImages({ kind: 'user', text: 't', imageCount: 99 });
  const c = im.cleanMessageImages({ kind: 'user', text: 't', imageCount: -3 });
  const d = im.cleanMessageImages({ kind: 'user', text: 't', images: [{ thumb: thumb() }], imageCount: 4 });
  return !('images' in a) && !('imageCount' in a) && b.imageCount === 5 && !('imageCount' in c) && d.images.length === 1 && !('imageCount' in d);
})());
check('trimOldThumbs keeps exactly the newest 12 image messages', (() => {
  const msgs = [];
  for (let i = 0; i < 20; i++) { msgs.push({ kind: 'user', text: `m${i}`, images: [{ thumb: thumb() }, { thumb: thumb() }] }); msgs.push({ kind: 'assistant', text: 'a' }); }
  im.trimOldThumbs(msgs);
  const withThumbs = msgs.filter((m) => m.images);
  const trimmed = msgs.filter((m) => m.imageCount === 2);
  return withThumbs.length === 12 && trimmed.length === 8 && msgs[0].imageCount === 2 && !msgs[0].images && msgs[msgs.length - 2].images.length === 2 && msgs.length === 40;
})());

// ----- renderer rules (lib/images.ts) -----
let rules;
try {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbh-images-'));
  fs.writeFileSync(path.join(tmp, 'images.mjs'), stripTypeScriptTypes(fs.readFileSync(path.join(root, 'src/renderer/lib/images.ts'), 'utf8')));
  rules = await import(pathToFileURL(path.join(tmp, 'images.mjs')).href);
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (e) { rules = { error: e }; }
if (rules.error) {
  check('lib/images.ts can be loaded', false, String(rules.error.message).slice(0, 120));
} else {
  const f = (type, name = 'x') => ({ type, name });
  const r1 = rules.pickImageFiles([f('image/png'), f('text/plain'), f('image/svg+xml'), f('image/jpeg')], 0);
  check('pickImageFiles: keeps png/jpeg/gif/webp, says why for others', r1.files.length === 2 && typeof r1.error === 'string' && r1.error.length > 0);
  const r2 = rules.pickImageFiles([f('image/png'), f('image/png'), f('image/png')], 3);
  check('pickImageFiles: respects the count limit', r2.files.length === 2 && typeof r2.error === 'string');
  check('pickImageFiles: nothing to say when all fit', (() => { const r = rules.pickImageFiles([f('image/gif')], 0); return r.files.length === 1 && r.error === null; })());
  check('canSend: text or at least one image, never while staging', rules.canSend('', 0) === false && rules.canSend('  ', 0) === false && rules.canSend('hi', 0) === true && rules.canSend('', 1) === true && rules.canSend('', 1, 1) === false);
  check('imageLabel is plain text', rules.imageLabel(1) === '[1 image]' && rules.imageLabel(2) === '[2 images]');
}

if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\nAll image checks passed');
