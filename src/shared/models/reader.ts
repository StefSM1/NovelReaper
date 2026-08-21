export type Theme = 'light' | 'dark';
export type ReaderMode = 'dashboard' | 'focus';
export type SafetyLevel = 'strict' | 'balanced' | 'trusted';
export type ChapterState = 'unread' | 'in-progress' | 'completed';

export interface ReaderLocator {
  spineIndex: number;
  href: string;
  cfi?: string;
  fraction: number;
  textQuote?: string;
}

export interface AppearanceSettings {
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
}

export type ReaderTarget =
  | { kind: 'locator'; locator: ReaderLocator }
  | { kind: 'spine'; spineIndex: number; fragment?: string };
