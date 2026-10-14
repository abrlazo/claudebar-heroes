// Pure rules for image attachments in the composer. UX only: main re-checks every byte
// (src/main/images.js) and is the authority on what is accepted.

export const MAX_IMAGES = 5; // keep in sync with src/main/images.js
export const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';
const TYPES = new Set(ACCEPT.split(','));

export const ERR_TYPE = 'Only PNG, JPEG, GIF and WebP images can be attached.';
export const ERR_COUNT = `At most ${MAX_IMAGES} images per message.`;

/** The files worth sending to main (by their declared type and the room left) and a fixed message when some were left out. */
export function pickImageFiles<T extends { type: string }>(files: readonly T[], have: number): { files: T[]; error: string | null } {
  const ok = files.filter((f) => TYPES.has(f.type));
  let error: string | null = ok.length < files.length ? ERR_TYPE : null;
  const room = Math.max(0, MAX_IMAGES - have);
  if (ok.length > room) error = ERR_COUNT;
  return { files: ok.slice(0, room), error };
}

/** A message can be sent with text, or with at least one image, and never while an image is still being staged. */
export function canSend(text: string, attached: number, pending = 0): boolean {
  if (pending > 0) return false;
  return text.trim().length > 0 || attached > 0;
}

/** Plain text shown in place of thumbnails that are no longer kept. */
export function imageLabel(n: number): string {
  return `[${n} image${n === 1 ? '' : 's'}]`;
}
