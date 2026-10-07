// Single access point for the preload bridge (see src/main/preload.js).
// Everything the renderer can ask of the main process goes through `bar`.
// Its shape is declared in ../types.ts.

import type { Bar } from '../types';

export const bar: Bar = window.bar;
