import type { ReaderLocator, ReaderMode, SafetyLevel, Theme } from './reader';

export interface BookRecord {
  id: string;
  sourcePath: string;
  sha256: string;
  fileSize: number;
  mtimeMs: number;
  title: string;
  authors: string[];
  coverCacheKey?: string;
  spineCount: number;
  availability: 'ready' | 'missing';
  lastOpenedAt?: number;
}

export interface BookProgress {
  schemaVersion: number;
  currentSpineIndex: number;
  completedSpineIndices: number[];
  positions: Record<string, ReaderLocator>;
  finished: boolean;
  updatedAt: number;
}

export interface ReaderSettings {
  schemaVersion: number;
  theme: Theme;
  fontFamily:
    | 'literata'
    | 'lora'
    | 'merriweather'
    | 'source-serif-4'
    | 'atkinson-hyperlegible';
  fontSizePx: number;
  lineHeight: 1.4 | 1.6 | 1.8;
  pageWidthCh: 54 | 68 | 82;
  readerMode: ReaderMode;
  safetyLevel: SafetyLevel;
}
