import { describe, expect, it } from 'vitest';

import { metadataFromBook, tocFromBook } from '../../../src/reader/publication-model';
import { createSyntheticEpub, createSyntheticEpub2 } from '../../fixtures/synthetic-epub';

describe('pinned Foliate EPUB adapter', () => {
  it('parses a legal synthetic EPUB 3 package, metadata, spine, and navigation document', async () => {
    const { makeBook } = await import('foliate-js/view.js');
    const book = await makeBook(createSyntheticEpub());
    try {
      expect(metadataFromBook(book.metadata, 'Fallback')).toMatchObject({
        title: 'Synthetic Reader Test',
        author: 'NovelReaper',
        language: 'en',
      });
      expect(book.sections).toHaveLength(2);
      expect(tocFromBook(book)).toMatchObject([
        { label: 'A Quiet Start', spineIndex: 0 },
        { label: 'The Second Page', spineIndex: 1 },
      ]);
    } finally {
      book.destroy?.();
    }
  });

  it('parses an EPUB 2 NCX table of contents through the same bounded model', async () => {
    const { makeBook } = await import('foliate-js/view.js');
    const book = await makeBook(createSyntheticEpub2());
    try {
      expect(metadataFromBook(book.metadata, 'Fallback').title).toBe('Synthetic EPUB Two');
      expect(tocFromBook(book)).toMatchObject([
        { label: 'EPUB Two Opening', spineIndex: 0 },
        { label: 'EPUB Two Ending', spineIndex: 1 },
      ]);
    } finally {
      book.destroy?.();
    }
  });
});
