import { z } from 'zod';

import {
  DEFAULT_READER_APPEARANCE,
  READER_FONT_FAMILIES,
  type ReaderAppearanceSettings,
} from '../../reader/appearance';

export const BROWSER_READER_SETTINGS_KEY = 'novelreaper:browser-settings:v1';

export type ReaderMode = 'dashboard' | 'focus';

export interface BrowserReaderPreferences {
  appearance: ReaderAppearanceSettings;
  mode: ReaderMode;
}

export const DEFAULT_BROWSER_READER_PREFERENCES: BrowserReaderPreferences = Object.freeze({
  appearance: DEFAULT_READER_APPEARANCE,
  mode: 'dashboard',
});

const preferencesSchema = z
  .object({
    schemaVersion: z.literal(1),
    appearance: z
      .object({
        theme: z.enum(['light', 'dark']),
        fontFamily: z.enum(READER_FONT_FAMILIES),
        fontSizePx: z.number().int().min(14).max(30),
        lineHeight: z.union([z.literal(1.4), z.literal(1.6), z.literal(1.8)]),
        pageWidthCh: z.union([z.literal(54), z.literal(68), z.literal(82)]),
      })
      .strict(),
    mode: z.enum(['dashboard', 'focus']),
  })
  .strict();

interface PreferencesLoadResult {
  preferences: BrowserReaderPreferences;
  warning?: string;
}

function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadBrowserReaderPreferences(): PreferencesLoadResult {
  const storage = browserStorage();
  if (!storage) {
    return {
      preferences: DEFAULT_BROWSER_READER_PREFERENCES,
      warning: 'Reader settings cannot be restored in this browser session.',
    };
  }
  try {
    const serialized = storage.getItem(BROWSER_READER_SETTINGS_KEY);
    if (!serialized) return { preferences: DEFAULT_BROWSER_READER_PREFERENCES };
    const parsed = preferencesSchema.safeParse(JSON.parse(serialized));
    if (parsed.success) {
      return {
        preferences: {
          appearance: parsed.data.appearance,
          mode: parsed.data.mode,
        },
      };
    }
    storage.removeItem(BROWSER_READER_SETTINGS_KEY);
    return {
      preferences: DEFAULT_BROWSER_READER_PREFERENCES,
      warning: 'Invalid reader settings were reset safely.',
    };
  } catch {
    return {
      preferences: DEFAULT_BROWSER_READER_PREFERENCES,
      warning: 'Reader settings cannot be restored in this browser session.',
    };
  }
}

export function saveBrowserReaderPreferences(preferences: BrowserReaderPreferences): boolean {
  const storage = browserStorage();
  if (!storage) return false;
  try {
    storage.setItem(
      BROWSER_READER_SETTINGS_KEY,
      JSON.stringify({ schemaVersion: 1, ...preferences }),
    );
    return true;
  } catch {
    return false;
  }
}
