import {
  app,
  BrowserWindow,
  session,
  type Session,
} from 'electron';
import { isAbsolute } from 'node:path';

import { IPC_CHANNELS } from '../shared/contracts/ipc';
import { registerShellIpc, publishReaderState, publishWindowState } from './ipc/shell-ipc';
import { registerBundledAssetProtocol } from './protocol/bundled-assets';
import {
  isSameDocumentNavigation,
  registerPrivilegedSchemes,
  serializedOrigin,
  SHELL_SCHEME,
} from './protocol/schemes';
import { ReaderViewManager, type ReaderDiagnostics } from './reader-view/ReaderViewManager';
import { attachContentGuards } from './security/content-guards';
import { installSessionDenyPolicy } from './security/session-policy';
import { createSecureWebPreferences } from './security/web-preferences';

interface AppRuntime {
  window: BrowserWindow;
  readerManager: ReaderViewManager;
  dispose: () => Promise<void>;
}

interface NovelReaperTestHook {
  diagnostics: () => ReaderDiagnostics;
  crashReader: () => void;
  recoverReader: () => Promise<void>;
}

declare global {
  // Main-process-only hook used by Playwright through ElectronApplication.evaluate.
  // It is never bridged to either renderer and exists only when NOVELREAPER_E2E=1.
  var __NOVELREAPER_TEST__: NovelReaperTestHook | undefined;
}

app.enableSandbox();
registerPrivilegedSchemes();

const testUserDataPath = process.env.NOVELREAPER_USER_DATA;
if (process.env.NOVELREAPER_E2E === '1' && testUserDataPath) {
  if (!isAbsolute(testUserDataPath)) throw new Error('E2E userData path must be absolute.');
  app.setPath('userData', testUserDataPath);
}

let runtime: AppRuntime | undefined;

function toggleFullscreen(window: BrowserWindow): void {
  window.setFullScreen(!window.isFullScreen());
  publishWindowState(window);
}

function exitFocusAndRecoverFullscreen(window: BrowserWindow): void {
  if (window.isFullScreen()) window.setFullScreen(false);
  window.webContents.send(IPC_CHANNELS.shellExitFocus);
  publishWindowState(window);
}

function installGlobalWebContentsDefenses(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  app.on('select-client-certificate', (event, _contents, _url, _certificates, callback) => {
    event.preventDefault();
    callback();
  });

  app.on('login', (event, _contents, _details, _authInfo, callback) => {
    event.preventDefault();
    callback();
  });
}

async function createRuntime(): Promise<AppRuntime> {
  const shellSession: Session = session.fromPartition('novelreaper-shell', { cache: false });
  const shellLoadUrl = app.isPackaged
    ? `${SHELL_SCHEME}://shell/index.html`
    : MAIN_WINDOW_WEBPACK_ENTRY;
  const cleanups: Array<() => void> = [];

  cleanups.push(
    installSessionDenyPolicy({
      session: shellSession,
      ...(!app.isPackaged ? { developmentEntryUrl: MAIN_WINDOW_WEBPACK_ENTRY } : {}),
    }),
  );

  if (app.isPackaged) {
    cleanups.push(
      registerBundledAssetProtocol({
        session: shellSession,
        scheme: SHELL_SCHEME,
        host: 'shell',
        entryUrl: MAIN_WINDOW_WEBPACK_ENTRY,
      }),
    );
  }

  const shellWebPreferences = createSecureWebPreferences(
    MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    shellSession,
  );
  const window = new BrowserWindow({
    width: 1536,
    height: 960,
    minWidth: 1200,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4eee5',
    title: 'NovelReaper',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#f7f0e7',
      symbolColor: '#245746',
      height: 48,
    },
    webPreferences: shellWebPreferences,
  });

  const expectedShellOrigin = serializedOrigin(shellLoadUrl);
  const keyboardFullscreen = (): void => toggleFullscreen(window);
  const keyboardEscape = (): void => exitFocusAndRecoverFullscreen(window);

  cleanups.push(
    attachContentGuards({
      contents: window.webContents,
      isNavigationAllowed: (url) => isSameDocumentNavigation(url, shellLoadUrl),
      onKeyboardEscape: keyboardEscape,
      onKeyboardFullscreen: keyboardFullscreen,
      onFailure: (failure) => console.error('Application shell failure', failure),
    }),
  );

  const readerManager = new ReaderViewManager(
    window,
    shellWebPreferences,
    (state) => publishReaderState(window, state),
    keyboardEscape,
    keyboardFullscreen,
  );

  cleanups.push(
    registerShellIpc({
      window,
      session: shellSession,
      expectedOrigin: expectedShellOrigin,
      readerManager,
    }),
  );

  const publishCurrentWindowState = (): void => publishWindowState(window);
  window.on('maximize', publishCurrentWindowState);
  window.on('unmaximize', publishCurrentWindowState);
  window.on('enter-full-screen', publishCurrentWindowState);
  window.on('leave-full-screen', publishCurrentWindowState);

  let disposed = false;
  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    globalThis.__NOVELREAPER_TEST__ = undefined;
    await readerManager.dispose();
    for (const cleanup of cleanups.reverse()) cleanup();
    await Promise.allSettled([
      shellSession.closeAllConnections(),
      shellSession.clearData(),
      shellSession.clearAuthCache(),
    ]);
  };

  let closeApproved = false;
  window.on('close', (event) => {
    if (closeApproved) return;
    event.preventDefault();
    void dispose().finally(() => {
      closeApproved = true;
      if (!window.isDestroyed()) window.destroy();
    });
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.once('did-finish-load', () => {
    void readerManager.create();
  });
  await window.loadURL(shellLoadUrl);

  if (process.env.NOVELREAPER_E2E === '1') {
    globalThis.__NOVELREAPER_TEST__ = {
      diagnostics: () => readerManager.getDiagnostics(),
      crashReader: () => readerManager.forceReaderCrashForTest(),
      recoverReader: async () => {
        await readerManager.recover();
      },
    };
  }

  return { window, readerManager, dispose };
}

installGlobalWebContentsDefenses();

void app.whenReady().then(async () => {
  runtime = await createRuntime();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createRuntime().then((nextRuntime) => {
        runtime = nextRuntime;
      });
    }
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  void runtime?.dispose();
});
