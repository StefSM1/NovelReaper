import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/browser-preview'),
  base: './',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    fs: {
      allow: [resolve(import.meta.dirname)],
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: false,
  },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/browser-preview'),
    emptyOutDir: true,
    sourcemap: true,
  },
});
