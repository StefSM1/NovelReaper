import { resolve } from 'node:path';

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
  // Windows tools can keep Vite's generated source maps open, which prevents
  // the optimizer from replacing node_modules/.vite on the next startup.
  // NovelReaper's browser dependencies are ESM, so serving them directly keeps
  // development reliable without changing production bundling.
  optimizeDeps: {
    noDiscovery: true,
    include: [],
  },
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
