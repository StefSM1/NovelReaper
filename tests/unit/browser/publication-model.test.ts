import { describe, expect, it } from 'vitest';

import { metadataFromBook, tocFromBook } from '../../../src/reader/publication-model';

describe('EPUB publication model', () => {
  it('normalizes localized metadata and a nested EPUB navigation tree', () => {
    const metadata = metadataFromBook(
      {
        title: { en: 'The Quiet Book' },
        author: [{ name: { en: 'A. Reader' } }],
        language: ['en'],
      },
      'Fallback',
    );
    const toc = tocFromBook({
      metadata: {},
      sections: [{}, {}],
      toc: [
        {
          label: 'Part One',
          href: 'one.xhtml',
          subitems: [{ label: 'A Beginning', href: 'one.xhtml#start' }],
        },
      ],
      resolveHref: (href) => ({ index: href.startsWith('one.xhtml') ? 0 : 1 }),
    });

    expect(metadata).toMatchObject({
      title: 'The Quiet Book',
      author: 'A. Reader',
      language: 'en',
    });
    expect(toc).toEqual([
      { id: 'toc-0', label: 'Part One', target: 'one.xhtml', depth: 0, spineIndex: 0 },
      {
        id: 'toc-1',
        label: 'A Beginning',
        target: 'one.xhtml#start',
        depth: 1,
        spineIndex: 0,
      },
    ]);
  });

  it('provides bounded spine labels when an EPUB has no navigation document', () => {
    const toc = tocFromBook({ sections: [{}, {}, {}] });
    expect(toc).toHaveLength(3);
    expect(toc[2]).toMatchObject({ label: 'Chapter 3', target: 2, spineIndex: 2 });
  });
});
