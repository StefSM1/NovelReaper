import { contextBridge, ipcRenderer } from 'electron';

import {
  IPC_CHANNELS,
  type NovelReaperShellApi,
  type ReaderBounds,
  type ReaderStateSnapshot,
  readerBoundsSchema,
  readerStateSnapshotSchema,
  shellBootstrapStateSchema,
  type WindowAction,
  type WindowStateSnapshot,
  windowActionSchema,
  windowStateSnapshotSchema,
} from '../shared/contracts/ipc';

const api: NovelReaperShellApi = Object.freeze({
  getBootstrapState: async () => {
    const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.shellBootstrap);
    return shellBootstrapStateSchema.parse(result);
  },
  setReaderBounds: async (bounds: ReaderBounds) => {
    await ipcRenderer.invoke(IPC_CHANNELS.shellReaderBounds, readerBoundsSchema.parse(bounds));
  },
  recoverReader: async () => {
    const result: unknown = await ipcRenderer.invoke(IPC_CHANNELS.shellReaderRecover);
    return readerStateSnapshotSchema.parse(result);
  },
  performWindowAction: async (action: WindowAction) => {
    const result: unknown = await ipcRenderer.invoke(
      IPC_CHANNELS.shellWindowAction,
      windowActionSchema.parse(action),
    );
    return windowStateSnapshotSchema.parse(result);
  },
  onReaderState: (listener: (state: ReaderStateSnapshot) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const result = readerStateSnapshotSchema.safeParse(payload);
      if (result.success) listener(result.data);
    };
    ipcRenderer.on(IPC_CHANNELS.shellReaderState, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.shellReaderState, wrapped);
  },
  onWindowState: (listener: (state: WindowStateSnapshot) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const result = windowStateSnapshotSchema.safeParse(payload);
      if (result.success) listener(result.data);
    };
    ipcRenderer.on(IPC_CHANNELS.shellWindowState, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.shellWindowState, wrapped);
  },
  onExitFocusRequested: (listener: () => void) => {
    const wrapped = (): void => listener();
    ipcRenderer.on(IPC_CHANNELS.shellExitFocus, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.shellExitFocus, wrapped);
  },
});

contextBridge.exposeInMainWorld('novelReaperShell', api);
