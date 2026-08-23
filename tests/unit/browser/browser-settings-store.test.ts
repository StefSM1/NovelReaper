import { beforeEach, describe, expect, it } from 'vitest';

import {
  BROWSER_READER_SETTINGS_KEY,
  DEFAULT_BROWSER_READER_PREFERENCES,
  loadBrowserReaderPreferences,
  saveBrowserReaderPreferences,
} from '../../../src/platform/browser/browser-settings-store';

describe('browser reader settings store', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips bounded appearance and mode settings', () => {
    const preferences = {
      appearance: {
        ...DEFAULT_BROWSER_READER_PREFERENCES.appearance,
        theme: 'dark' as const,
        fontFamily: 'lora' as const,
        fontSizePx: 24,
        lineHeight: 1.8 as const,
        pageWidthCh: 82 as const,
      },
      mode: 'focus' as const,
    };

    expect(saveBrowserReaderPreferences(preferences)).toBe(true);
    expect(loadBrowserReaderPreferences()).toEqual({ preferences });
  });

  it('resets corrupt or out-of-range settings safely', () => {
    window.localStorage.setItem(
      BROWSER_READER_SETTINGS_KEY,
      JSON.stringify({
        schemaVersion: 1,
        appearance: { theme: 'neon', fontSizePx: 200 },
        mode: 'focus',
      }),
    );

    expect(loadBrowserReaderPreferences()).toEqual({
      preferences: DEFAULT_BROWSER_READER_PREFERENCES,
      warning: 'Invalid reader settings were reset safely.',
    });
    expect(window.localStorage.getItem(BROWSER_READER_SETTINGS_KEY)).toBeNull();
  });
});
