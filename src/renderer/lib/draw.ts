// Pure rules of `/draw <description>` on the renderer side. Main validates everything again.

/** Longest description sent (main refuses more). Keep equal to MAX_DESCRIPTION in main/pixel-art.js. */
export const MAX_DRAW_DESCRIPTION = 200;

export type DrawCommand = { description: string } | { empty: true };

/** `/draw <description>` (case-insensitive; `/drawing` is not it). `null` when the text is not the command. */
export function parseDrawCommand(text: string): DrawCommand | null {
  const m = text.match(/^\s*\/draw(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const description = (m[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DRAW_DESCRIPTION).trim();
  return description ? { description } : { empty: true };
}

/** Whole-number scale for an `w`-cell-wide drawing in `available` CSS pixels: at most 192 px, at least 3x. */
export function scaleFor(available: number, w: number): number {
  const byWidth = Math.floor(Math.min(available, 192) / Math.max(1, w));
  return Math.max(3, byWidth);
}
