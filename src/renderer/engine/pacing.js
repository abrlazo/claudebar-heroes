// Frame pacing for the battle loop (pure, no DOM). The loop runs on requestAnimationFrame at the display rate;
// these helpers decide whether a frame is drawn. All game timing is dt-based, so skipped frames lose nothing.

export const AWAKE_FRAME_MS = 1000 / 30; // hero working, enemies, transitions
export const IDLE_FRAME_MS = 1000 / 12;  // hero asleep and nothing else moving (weather only)
const TOLERANCE_MS = 2;                  // rAF jitter: 60 Hz must still land on every 2nd / 5th frame

export const frameInterval = (busy) => (busy ? AWAKE_FRAME_MS : IDLE_FRAME_MS);
export const frameDue = (now, last, interval) => now - last >= interval - TOLERANCE_MS;
export const clampDt = (now, last, max = 100) => Math.min(now - last, max);
