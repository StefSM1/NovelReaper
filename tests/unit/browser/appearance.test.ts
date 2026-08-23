import { describe, expect, it } from 'vitest';

import {
  DEFAULT_READER_APPEARANCE,
  normalizeReaderAppearance,
  READER_PARAGRAPH_GAP_EM,
} from '../../../src/reader/appearance';

describe('reader appearance', () => {
  it('changes paragraph rhythm monotonically with line spacing', () => {
    expect(READER_PARAGRAPH_GAP_EM[1.4]).toBeLessThan(READER_PARAGRAPH_GAP_EM[1.6]);
    expect(READER_PARAGRAPH_GAP_EM[1.6]).toBeLessThan(READER_PARAGRAPH_GAP_EM[1.8]);
  });

  it('bounds font size without changing the selected spacing preset', () => {
    expect(
      normalizeReaderAppearance({
        ...DEFAULT_READER_APPEARANCE,
        fontSizePx: 200,
        lineHeight: 1.4,
      }),
    ).toMatchObject({ fontSizePx: 30, lineHeight: 1.4 });
  });
});
