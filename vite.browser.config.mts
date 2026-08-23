import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function foliateEpubOnlyCompatibility(): Plugin {
  const virtualPdfModule = '\0novelreaper:foliate-pdf-disabled';
  return {
    name: 'novelreaper-foliate-epub-only',
    enforce: 'pre',
    resolveId(source: string, importer: string | undefined) {
      if (
        source === './pdf.js' &&
        importer?.replaceAll('\\', '/').endsWith('/foliate-js/view.js')
      ) {
        return virtualPdfModule;
      }
      return null;
    },
    load(id) {
      if (id !== virtualPdfModule) return null;
      return 'export async function makePDF() { throw new Error("PDF is outside NovelReaper v1."); }';
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/browser-preview'),
  base: './',
  plugins: [foliateEpubOnlyCompatibility(), react()],
  // React's CommonJS runtime must be optimized before the browser can load it.
  // A fresh Windows temp cache per launch prevents another editor or Vite process
  // from locking the files that a later launch needs to replace.
  cacheDir: resolve(tmpdir(), `novelreaper-vite-${randomUUID()}`),
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
