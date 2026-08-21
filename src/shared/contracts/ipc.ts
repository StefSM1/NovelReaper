import { z } from 'zod';

export const IPC_CHANNELS = Object.freeze({
  shellBootstrap: 'novelreaper:shell:bootstrap',
  shellReaderBounds: 'novelreaper:shell:reader-bounds',
  shellReaderRecover: 'novelreaper:shell:reader-recover',
  shellReaderState: 'novelreaper:shell:reader-state',
  shellWindowAction: 'novelreaper:shell:window-action',
  shellWindowState: 'novelreaper:shell:window-state',
  shellExitFocus: 'novelreaper:shell:exit-focus',
  readerCommand: 'novelreaper:reader:command',
  readerEvent: 'novelreaper:reader:event',
});

export const windowActionSchema = z.enum([
  'minimize',
  'toggle-maximize',
  'close',
  'toggle-fullscreen',
  'exit-focus',
]);

export type WindowAction = z.infer<typeof windowActionSchema>;

export const readerBoundsSchema = z
  .object({
    x: z.number().int().min(0).max(100_000),
    y: z.number().int().min(0).max(100_000),
    width: z.number().int().min(1).max(100_000),
    height: z.number().int().min(1).max(100_000),
  })
  .strict();

export type ReaderBounds = z.infer<typeof readerBoundsSchema>;

export const readerStateSnapshotSchema = z
  .object({
    status: z.enum(['idle', 'creating', 'loading', 'ready', 'crashed', 'destroyed']),
    generation: z.number().int().min(0),
    canRetry: z.boolean(),
    message: z.string().max(256).optional(),
  })
  .strict();

export type ReaderStateSnapshot = z.infer<typeof readerStateSnapshotSchema>;

export const windowStateSnapshotSchema = z
  .object({
    isMaximized: z.boolean(),
    isFullScreen: z.boolean(),
  })
  .strict();

export type WindowStateSnapshot = z.infer<typeof windowStateSnapshotSchema>;

export const shellBootstrapStateSchema = z
  .object({
    appName: z.literal('NovelReaper'),
    appVersion: z.string().min(1).max(64),
    reader: readerStateSnapshotSchema,
    window: windowStateSnapshotSchema,
  })
  .strict();

export type ShellBootstrapState = z.infer<typeof shellBootstrapStateSchema>;

const readyEventSchema = z
  .object({
    type: z.literal('ready'),
    protocolVersion: z.literal(1),
  })
  .strict();

const pongEventSchema = z
  .object({
    type: z.literal('pong'),
    nonce: z.string().uuid(),
  })
  .strict();

const readerErrorEventSchema = z
  .object({
    type: z.literal('reader-error'),
    code: z.string().min(1).max(64).regex(/^[A-Z0-9_]+$/),
    message: z.string().min(1).max(512),
    fatal: z.boolean(),
  })
  .strict();

export const readerToMainEventSchema = z.discriminatedUnion('type', [
  readyEventSchema,
  pongEventSchema,
  readerErrorEventSchema,
]);

export type ReaderToMainEvent = z.infer<typeof readerToMainEventSchema>;

const pingCommandSchema = z
  .object({
    type: z.literal('ping'),
    nonce: z.string().uuid(),
  })
  .strict();

const prepareCloseCommandSchema = z
  .object({
    type: z.literal('prepare-close'),
  })
  .strict();

export const mainToReaderCommandSchema = z.discriminatedUnion('type', [
  pingCommandSchema,
  prepareCloseCommandSchema,
]);

export type MainToReaderCommand = z.infer<typeof mainToReaderCommandSchema>;

export interface NovelReaperShellApi {
  getBootstrapState: () => Promise<ShellBootstrapState>;
  setReaderBounds: (bounds: ReaderBounds) => Promise<void>;
  recoverReader: () => Promise<ReaderStateSnapshot>;
  performWindowAction: (action: WindowAction) => Promise<WindowStateSnapshot>;
  onReaderState: (listener: (state: ReaderStateSnapshot) => void) => () => void;
  onWindowState: (listener: (state: WindowStateSnapshot) => void) => () => void;
  onExitFocusRequested: (listener: () => void) => () => void;
}

export interface NovelReaperReaderApi {
  report: (event: ReaderToMainEvent) => void;
  onCommand: (listener: (command: MainToReaderCommand) => void) => () => void;
}
