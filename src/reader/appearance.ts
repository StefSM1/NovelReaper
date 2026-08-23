export const READER_FONT_FAMILIES = [
  'literata',
  'lora',
  'merriweather',
  'source-serif-4',
  'atkinson-hyperlegible',
] as const;

export type ReaderFontFamily = (typeof READER_FONT_FAMILIES)[number];
export type ReaderTheme = 'dark' | 'light';
export type ReaderLineHeight = 1.4 | 1.6 | 1.8;
export type ReaderPageWidth = 54 | 68 | 82;

export interface ReaderAppearanceSettings {
  theme: ReaderTheme;
  fontFamily: ReaderFontFamily;
  fontSizePx: number;
  lineHeight: ReaderLineHeight;
  pageWidthCh: ReaderPageWidth;
}

export const DEFAULT_READER_APPEARANCE: ReaderAppearanceSettings = Object.freeze({
  theme: 'light',
  fontFamily: 'literata',
  fontSizePx: 20,
  lineHeight: 1.6,
  pageWidthCh: 68,
});

export const READER_FONT_LABELS: Record<ReaderFontFamily, string> = {
  literata: 'Literata',
  lora: 'Lora',
  merriweather: 'Merriweather',
  'source-serif-4': 'Source Serif 4',
  'atkinson-hyperlegible': 'Atkinson Hyperlegible',
};

export const READER_FONT_CSS: Record<ReaderFontFamily, string> = {
  literata: "'Literata', Georgia, serif",
  lora: "'Lora', Georgia, serif",
  merriweather: "'Merriweather', Georgia, serif",
  'source-serif-4': "'Source Serif 4', Georgia, serif",
  'atkinson-hyperlegible': "'Atkinson Hyperlegible', system-ui, sans-serif",
};

export const READER_PARAGRAPH_GAP_EM: Record<ReaderLineHeight, number> = {
  1.4: 0.65,
  1.6: 1,
  1.8: 1.35,
};

export function normalizeReaderAppearance(
  settings: ReaderAppearanceSettings,
): ReaderAppearanceSettings {
  return {
    theme: settings.theme === 'dark' ? 'dark' : 'light',
    fontFamily: READER_FONT_FAMILIES.includes(settings.fontFamily)
      ? settings.fontFamily
      : DEFAULT_READER_APPEARANCE.fontFamily,
    fontSizePx: Math.min(30, Math.max(14, Math.round(settings.fontSizePx))),
    lineHeight: [1.4, 1.6, 1.8].includes(settings.lineHeight)
      ? settings.lineHeight
      : DEFAULT_READER_APPEARANCE.lineHeight,
    pageWidthCh: [54, 68, 82].includes(settings.pageWidthCh)
      ? settings.pageWidthCh
      : DEFAULT_READER_APPEARANCE.pageWidthCh,
  };
}
