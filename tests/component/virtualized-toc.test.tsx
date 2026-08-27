import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { ReaderTocItem } from '../../src/reader/contracts';
import { createReaderProgress } from '../../src/reader/progress-state';
import { VirtualizedToc } from '../../src/renderer/app/VirtualizedToc';

describe('VirtualizedToc', () => {
  it('keeps a multi-thousand-chapter contents list bounded', () => {
    const items: ReaderTocItem[] = Array.from({ length: 5000 }, (_, index) => ({
      id: `toc-${index}`,
      label: `Chapter ${index + 1}`,
      target: `chapter-${index}.xhtml`,
      depth: index % 7,
      spineIndex: index,
    }));

    render(
      <VirtualizedToc
        items={items}
        location={{
          spineIndex: 0,
          href: 'chapter-0.xhtml',
          fractionInChapter: 0.2,
          activeTocId: 'toc-0',
        }}
        progress={createReaderProgress(items.map((_item, index) => index))}
        busy={false}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Table of contents' })).toBeVisible();
    expect(screen.getAllByRole('button').length).toBeLessThan(40);
    expect(screen.getByRole('button', { name: /Chapter 1/ })).toHaveAttribute(
      'aria-current',
      'location',
    );
    const active = screen.getByRole('button', { name: /Chapter 1/ });
    const title = active.querySelector('strong');
    const status = active.querySelector('.toc__status');
    expect(status).toHaveTextContent('•');
    expect(Array.from(active.children).indexOf(status as Element)).toBeGreaterThan(
      Array.from(active.children).indexOf(title as Element),
    );
  });
});
