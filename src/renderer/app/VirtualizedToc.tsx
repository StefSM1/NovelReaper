import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { ReaderRelocation, ReaderTocItem } from '../../reader/contracts';
import {
  chapterProgressState,
  type ChapterProgressState,
  type ReaderProgressState,
} from '../../reader/progress-state';

const ROW_HEIGHT = 44;
const OVERSCAN = 6;

interface VirtualizedTocProps {
  items: ReaderTocItem[];
  location: ReaderRelocation | undefined;
  progress: ReaderProgressState | undefined;
  busy: boolean;
  onOpen: (item: ReaderTocItem) => void;
}

function itemState(
  item: ReaderTocItem,
  progress: ReaderProgressState | undefined,
): ChapterProgressState {
  if (!progress || item.spineIndex === undefined) return 'unread';
  return chapterProgressState(progress, item.spineIndex);
}

export function VirtualizedToc({
  items,
  location,
  progress,
  busy,
  onOpen,
}: VirtualizedTocProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const activeIndex = useMemo(
    () => items.findIndex((item) => item.id === location?.activeTocId),
    [items, location?.activeTocId],
  );

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateHeight = (): void => setViewportHeight(Math.max(ROW_HEIGHT, viewport.clientHeight));
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || activeIndex < 0) return;
    const rowTop = activeIndex * ROW_HEIGHT;
    const rowBottom = rowTop + ROW_HEIGHT;
    const visibleTop = viewport.scrollTop;
    const visibleBottom = visibleTop + viewport.clientHeight;
    if (rowTop >= visibleTop && rowBottom <= visibleBottom) return;
    const nextTop = Math.max(0, rowTop - Math.max(0, viewport.clientHeight / 2 - ROW_HEIGHT));
    viewport.scrollTop = nextTop;
    setScrollTop(nextTop);
  }, [activeIndex]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const end = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN,
  );
  const visibleItems = items.slice(start, end);

  return (
    <nav className="toc" aria-label="Table of contents" aria-busy={busy}>
      <div
        className="toc__viewport"
        ref={viewportRef}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <ol style={{ height: `${items.length * ROW_HEIGHT}px` }}>
          {visibleItems.map((item, visibleIndex) => {
            const itemIndex = start + visibleIndex;
            const state = itemState(item, progress);
            const active = location?.activeTocId === item.id;
            return (
              <li
                key={item.id}
                style={{ height: ROW_HEIGHT, transform: `translateY(${itemIndex * ROW_HEIGHT}px)` }}
              >
                <button
                  className={`toc__item toc__item--${state}${active ? ' toc__item--active' : ''}`}
                  style={
                    {
                      '--toc-indent': `${Math.min(item.depth, 4) * 0.7}rem`,
                    } as React.CSSProperties
                  }
                  type="button"
                  disabled={busy}
                  aria-current={active ? 'location' : undefined}
                  data-chapter-state={state}
                  onClick={() => onOpen(item)}
                >
                  <span className="toc__number">
                    {item.label.match(/^(\d+)\s*:/)?.[1] ?? itemIndex + 1}
                  </span>
                  <strong>{item.label}</strong>
                  <span className="toc__status" aria-hidden="true">
                    {state === 'completed' ? '✓' : state === 'in-progress' ? '•' : ''}
                  </span>
                  <span className="visually-hidden">{state.replace('-', ' ')}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
