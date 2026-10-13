/// <reference types="vite/client" />

/** The floating bubble's own bridge (src/main/bubble-preload.js). Only the bubble page has it; the app's `window.bar` is not there. */
interface Window {
  bubble?: {
    press(): void;
    release(): void;
    menu(): void;
    onState(cb: (state: unknown) => void): () => void;
  };
}
