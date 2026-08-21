import type {
  ReaderBounds,
  ReaderStateSnapshot,
  WindowStateSnapshot,
} from '../shared/contracts/ipc';

export type PlatformEnvironment = 'browser-preview' | 'electron';

export interface PlatformCapabilities {
  selectLocalPublication: boolean;
  durableSourceAccess: boolean;
  relink: boolean;
  nativeWindowControls: boolean;
  fullscreen: boolean;
}

export type PublicationAvailability = 'selected' | 'reselect-required';

export interface PublicationDescriptor {
  id: string;
  displayName: string;
  fileSize: number;
  lastModified: number;
  mimeType: string;
  availability: PublicationAvailability;
}

export interface SelectedPublication extends PublicationDescriptor {
  availability: 'selected';
  file: File;
}

export type PublicationSelectionResult =
  | { status: 'selected'; publication: SelectedPublication; warning?: string }
  | { status: 'cancelled' }
  | { status: 'unsupported'; reason: string };

export interface PlatformBootstrapState {
  appName: 'NovelReaper';
  appVersion: string;
  environment: PlatformEnvironment;
  capabilities: PlatformCapabilities;
  reader: ReaderStateSnapshot;
  window: WindowStateSnapshot;
  recentPublication?: PublicationDescriptor;
  notices: string[];
}

export interface NovelReaperPlatform {
  readonly environment: PlatformEnvironment;
  readonly capabilities: PlatformCapabilities;
  getBootstrapState: () => Promise<PlatformBootstrapState>;
  selectPublication: () => Promise<PublicationSelectionResult>;
  setReaderBounds: (bounds: ReaderBounds) => Promise<void>;
  recoverReader: () => Promise<ReaderStateSnapshot>;
  toggleFullscreen: () => Promise<WindowStateSnapshot>;
  onReaderState: (listener: (state: ReaderStateSnapshot) => void) => () => void;
  onWindowState: (listener: (state: WindowStateSnapshot) => void) => () => void;
  onExitFocusRequested: (listener: () => void) => () => void;
}

export type PlatformErrorCode =
  | 'EMPTY_FILE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_EPUB_EXTENSION'
  | 'INVALID_ZIP_SIGNATURE'
  | 'UNSUPPORTED_FEATURE';

export class PlatformOperationError extends Error {
  public constructor(
    public readonly code: PlatformErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PlatformOperationError';
  }
}

export function platformErrorMessage(error: unknown): string {
  if (error instanceof PlatformOperationError) return error.message;
  return 'NovelReaper could not complete that browser operation.';
}
