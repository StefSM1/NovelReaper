export type ReaderNavigationTarget = string | number;

export interface ReaderMetadata {
  title: string;
  author?: string;
  language?: string;
  description?: string;
  coverUrl?: string;
}

export interface ReaderTocItem {
  id: string;
  label: string;
  target: ReaderNavigationTarget;
  depth: number;
  spineIndex?: number;
}

export interface ReaderPublication {
  metadata: ReaderMetadata;
  toc: ReaderTocItem[];
  spineLength: number;
  linearSpineIndices: number[];
}

export interface ReaderLocator {
  spineIndex: number;
  href: string;
  fractionInChapter: number;
  cfi?: string;
  textQuote?: string;
}

export interface ReaderRelocation extends ReaderLocator {
  chapterLabel?: string;
  activeTocId?: string;
}

export type ReaderNavigationSource = 'contents' | 'finish' | 'internal' | 'next' | 'previous';

export type ReaderNavigationRequest =
  | { source: 'contents'; target: ReaderNavigationTarget }
  | { source: 'internal'; target: ReaderNavigationTarget }
  | { source: 'next' | 'previous' | 'finish' };

export interface ReaderNavigationState {
  busy: boolean;
  finished: boolean;
}

export type ReaderEngineEvent =
  | { type: 'relocation'; location: ReaderRelocation }
  | { type: 'navigation-request'; request: ReaderNavigationRequest }
  | { type: 'error'; message: string; recoverable: boolean };

export interface ReaderEngine {
  open: (
    source: File,
    container: HTMLElement,
    initialLocator?: ReaderLocator,
  ) => Promise<ReaderPublication>;
  goTo: (target: ReaderNavigationTarget, locator?: ReaderLocator) => Promise<void>;
  setNavigationState: (state: ReaderNavigationState) => void;
  subscribe: (listener: (event: ReaderEngineEvent) => void) => () => void;
  destroy: () => void;
}

export type ReaderEngineFactory = () => ReaderEngine;

export type ReaderEngineErrorCode =
  'ENCRYPTED_EPUB' | 'MALFORMED_EPUB' | 'NAVIGATION_FAILED' | 'OPEN_FAILED' | 'UNSUPPORTED_LAYOUT';

export class ReaderEngineError extends Error {
  public constructor(
    public readonly code: ReaderEngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReaderEngineError';
  }
}

export function readerErrorMessage(error: unknown): string {
  if (error instanceof ReaderEngineError) return error.message;
  return 'NovelReaper could not read this EPUB. The selected file has not been changed.';
}
