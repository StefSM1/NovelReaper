import { app, type BrowserWindow, type Session } from 'electron';

import {
  IPC_CHANNELS,
  readerBoundsSchema,
  type ReaderStateSnapshot,
  shellBootstrapStateSchema,
  windowActionSchema,
  type WindowStateSnapshot,
  windowStateSnapshotSchema,
} from '../../shared/contracts/ipc';
import type { ReaderViewManager } from '../reader-view/ReaderViewManager';
import { authorizeTopFrameIpc } from '../security/ipc-authorization';

export function getWindowState(window: BrowserWindow): WindowStateSnapshot {
  return windowStateSnapshotSchema.parse({
    isMaximized: window.isMaximized(),
    isFullScreen: window.isFullScreen(),
  });
}

export function registerShellIpc(options: {
  window: BrowserWindow;
  session: Session;
  expectedOrigin: string;
  readerManager: ReaderViewManager;
}): () => void {
  const { window, session, expectedOrigin, readerManager } = options;
  const scopedIpc = window.webContents.ipc;

  const authorize = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): void => {
    authorizeTopFrameIpc(event, window.webContents, session, expectedOrigin);
  };

  scopedIpc.handle(IPC_CHANNELS.shellBootstrap, (event) => {
    authorize(event);
    return shellBootstrapStateSchema.parse({
      appName: 'NovelReaper',
      appVersion: app.getVersion(),
      reader: readerManager.getState(),
      window: getWindowState(window),
    });
  });

  scopedIpc.handle(IPC_CHANNELS.shellReaderBounds, (event, payload: unknown) => {
    authorize(event);
    readerManager.setBounds(readerBoundsSchema.parse(payload));
  });

  scopedIpc.handle(IPC_CHANNELS.shellReaderRecover, async (event) => {
    authorize(event);
    return readerManager.recover();
  });

  scopedIpc.handle(IPC_CHANNELS.shellWindowAction, (event, payload: unknown) => {
    authorize(event);
    const action = windowActionSchema.parse(payload);

    if (action === 'minimize') window.minimize();
    if (action === 'toggle-maximize') {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    }
    if (action === 'toggle-fullscreen') window.setFullScreen(!window.isFullScreen());
    if (action === 'exit-focus') {
      window.webContents.send(IPC_CHANNELS.shellExitFocus);
    }
    if (action === 'close') {
      queueMicrotask(() => window.close());
    }

    return getWindowState(window);
  });

  return () => {
    scopedIpc.removeHandler(IPC_CHANNELS.shellBootstrap);
    scopedIpc.removeHandler(IPC_CHANNELS.shellReaderBounds);
    scopedIpc.removeHandler(IPC_CHANNELS.shellReaderRecover);
    scopedIpc.removeHandler(IPC_CHANNELS.shellWindowAction);
  };
}

export function publishReaderState(
  window: BrowserWindow,
  state: ReaderStateSnapshot,
): void {
  if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.shellReaderState, state);
  }
}

export function publishWindowState(window: BrowserWindow): void {
  if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.shellWindowState, getWindowState(window));
  }
}
