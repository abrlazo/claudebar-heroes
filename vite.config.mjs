import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// The renderer lives in src/renderer; Electron loads the built output from
// dist/renderer, so asset URLs must be relative (file://).
export default defineConfig({
  root: path.resolve(here, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(here, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome140',
    // Two pages: the app and the small floating bubble (src/renderer/bubble.html).
    rollupOptions: {
      input: {
        main: path.resolve(here, 'src/renderer/index.html'),
        bubble: path.resolve(here, 'src/renderer/bubble.html'),
      },
    },
  },
});
