import type { NovelReaperReaderApi, NovelReaperShellApi } from './ipc';

declare global {
  interface Window {
    novelReaperReader: NovelReaperReaderApi;
    novelReaperShell: NovelReaperShellApi;
  }
}

export {};
