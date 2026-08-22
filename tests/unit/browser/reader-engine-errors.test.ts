import { describe, expect, it } from 'vitest';

import { FoliateReaderEngine } from '../../../src/reader/FoliateReaderEngine';
import type { ReaderEngineError } from '../../../src/reader/contracts';
import { createSyntheticEpub } from '../../fixtures/synthetic-epub';

describe('reader engine publication errors', () => {
  it('rejects malformed EPUB packages with a recoverable bounded error', async () => {
    const engine = new FoliateReaderEngine();
    const malformed = new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])],
      'broken.epub',
      { type: 'application/epub+zip' },
    );

    await expect(engine.open(malformed, document.createElement('div'))).rejects.toMatchObject({
      code: 'MALFORMED_EPUB',
    } satisfies Partial<ReaderEngineError>);
  });

  it('rejects fixed-layout publications before mounting a chapter', async () => {
    const engine = new FoliateReaderEngine();
    await expect(
      engine.open(createSyntheticEpub({ fixedLayout: true }), document.createElement('div')),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_LAYOUT' } satisfies Partial<ReaderEngineError>);
  });
});
