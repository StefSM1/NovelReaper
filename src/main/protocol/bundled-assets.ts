import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Session } from 'electron';

const PRODUCTION_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "worker-src 'none'",
  "manifest-src 'none'",
].join('; ');

function collectFiles(rootDirectory: string): string[] {
  const files: string[] = [];

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      if (entry.isFile()) files.push(fullPath);
    }
  };

  visit(rootDirectory);
  return files;
}

function buildAssetManifest(entryUrl: string): ReadonlyMap<string, string> {
  const entryPath = fileURLToPath(entryUrl);
  const entryDirectory = dirname(entryPath);
  const rendererDirectory = dirname(entryDirectory);
  const assetsDirectory = join(rendererDirectory, 'assets');
  const entryName = basename(entryDirectory);
  const manifest = new Map<string, string>();

  for (const filePath of collectFiles(entryDirectory)) {
    const relativePath = relative(entryDirectory, filePath).split(sep).join('/');
    if (relativePath === 'preload.js' || relativePath === 'preload.js.map') continue;
    manifest.set(`/${entryName}/${relativePath}`, filePath);
  }

  for (const filePath of collectFiles(assetsDirectory)) {
    const relativePath = relative(assetsDirectory, filePath).split(sep).join('/');
    manifest.set(`/assets/${relativePath}`, filePath);
  }

  manifest.set('/', entryPath);
  manifest.set('/index.html', entryPath);
  return manifest;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function securityHeaders(filePath: string): Headers {
  const headers = new Headers();
  headers.set('Content-Security-Policy', PRODUCTION_CSP);
  headers.set('Content-Type', MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  return headers;
}

export function registerBundledAssetProtocol(options: {
  session: Session;
  scheme: string;
  host: string;
  entryUrl: string;
}): () => void {
  const { session, scheme, host, entryUrl } = options;
  const manifest = buildAssetManifest(entryUrl);

  session.protocol.handle(scheme, async (request) => {
    const url = new URL(request.url);
    if (url.protocol !== `${scheme}:` || url.host !== host) {
      return new Response('Not found', { status: 404 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { Allow: 'GET, HEAD' },
      });
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    const filePath = manifest.get(pathname);
    if (!filePath) return new Response('Not found', { status: 404 });

    const body = request.method === 'HEAD' ? null : new Uint8Array(await readFile(filePath));
    return new Response(body, { status: 200, headers: securityHeaders(filePath) });
  });

  return () => {
    session.protocol.unhandle(scheme);
  };
}
