import { describe, expect, it } from 'vitest';

import {
  chapterProgressState,
  createReaderProgress,
  overallProgress,
  readerProgressReducer,
} from '../../../src/reader/progress-state';

function location(spineIndex: number, fractionInChapter = 0) {
  return {
    spineIndex,
    href: `text/${spineIndex}.xhtml`,
    fractionInChapter,
  };
}

describe('reader progress state', () => {
  it('saves relocation without completing a chapter', () => {
    const initial = createReaderProgress([1, 2, 3]);
    const relocated = readerProgressReducer(initial, {
      type: 'relocate',
      location: { ...location(1, 0.72), textQuote: 'A stable sentence near the viewport.' },
      now: 10,
    });

    expect(relocated.currentSpineIndex).toBe(1);
    expect(relocated.positions['1']).toMatchObject({ fractionInChapter: 0.72 });
    expect(relocated.completedSpineIndices).toEqual([]);
    expect(chapterProgressState(relocated, 1)).toBe('in-progress');
    expect(overallProgress(relocated)).toBe(0);
  });

  it('completes only through Next and never double-counts', () => {
    const initial = createReaderProgress([1, 2, 3]);
    const contentsJump = readerProgressReducer(initial, {
      type: 'navigate',
      source: 'contents',
      fromSpineIndex: 1,
      destinationSpineIndex: 2,
    });
    expect(contentsJump.completedSpineIndices).toEqual([]);

    const next = readerProgressReducer(contentsJump, {
      type: 'navigate',
      source: 'next',
      fromSpineIndex: 2,
      destinationSpineIndex: 3,
    });
    const repeated = readerProgressReducer(next, {
      type: 'navigate',
      source: 'next',
      fromSpineIndex: 2,
      destinationSpineIndex: 3,
    });
    expect(repeated.completedSpineIndices).toEqual([2]);
    expect(overallProgress(repeated)).toBeCloseTo(1 / 3);
    expect(chapterProgressState(repeated, 2)).toBe('completed');
  });

  it('uses Finish Book to produce an exact completed state', () => {
    const initial = createReaderProgress([4, 7, 9]);
    const atFinal = readerProgressReducer(initial, {
      type: 'navigate',
      source: 'contents',
      fromSpineIndex: 4,
      destinationSpineIndex: 9,
    });
    const finished = readerProgressReducer(atFinal, { type: 'finish', spineIndex: 9 });

    expect(finished.finished).toBe(true);
    expect(finished.completedSpineIndices).toEqual([4, 7, 9]);
    expect(overallProgress(finished)).toBe(1);
  });

  it('sanitizes stale stored positions against the current linear spine', () => {
    const state = createReaderProgress([2, 3], {
      schemaVersion: 1,
      currentSpineIndex: 999,
      completedSpineIndices: [2, 999],
      positions: {
        '2': location(2, 2),
        '999': location(999, 0.5),
      },
      finished: true,
      updatedAt: 1,
    });

    expect(state.currentSpineIndex).toBe(2);
    expect(state.completedSpineIndices).toEqual([2]);
    expect(state.positions).toEqual({ '2': location(2, 1) });
    expect(state.finished).toBe(false);
  });
});
