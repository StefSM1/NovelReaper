import { contextBridge, ipcRenderer } from 'electron';

import {
  IPC_CHANNELS,
  type MainToReaderCommand,
  mainToReaderCommandSchema,
  type NovelReaperReaderApi,
  type ReaderToMainEvent,
  readerToMainEventSchema,
} from '../shared/contracts/ipc';

const api: NovelReaperReaderApi = Object.freeze({
  report: (event: ReaderToMainEvent) => {
    ipcRenderer.send(IPC_CHANNELS.readerEvent, readerToMainEventSchema.parse(event));
  },
  onCommand: (listener: (command: MainToReaderCommand) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const result = mainToReaderCommandSchema.safeParse(payload);
      if (result.success) listener(result.data);
    };
    ipcRenderer.on(IPC_CHANNELS.readerCommand, wrapped);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.readerCommand, wrapped);
  },
});

contextBridge.exposeInMainWorld('novelReaperReader', api);
