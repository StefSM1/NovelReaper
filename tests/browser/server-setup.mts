import { resolve } from 'node:path';

export default async function startBrowserTestServer(): Promise<() => Promise<void>> {
  const { preview } = await import('vite');
  // Own the server in-process so Windows cleanup does not depend on taskkill
  // finding and terminating a shell's child process tree.
  const server = await preview({
    configFile: false,
    root: resolve('src/browser-preview'),
    build: { outDir: resolve('dist/browser-preview') },
    preview: { host: '127.0.0.1', port: 4177, strictPort: true },
  });
  return () =>
    new Promise<void>((resolve, reject) => {
      server.httpServer.close((error) => (error ? reject(error) : resolve()));
      if ('closeAllConnections' in server.httpServer) server.httpServer.closeAllConnections();
    });
}
