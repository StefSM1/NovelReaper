import type { ReaderLocator, ReaderNavigationSource, ReaderRelocation } from './contracts';

export interface StoredReaderProgress {
  schemaVersion: 1;
  currentSpineIndex: number;
  completedSpineIndices: number[];
  positions: Record<string, ReaderLocator>;
  finished: boolean;
  updatedAt: number;
}

export interface ReaderProgressState extends StoredReaderProgress {
  linearSpineIndices: number[];
}

export type ChapterProgressState = 'completed' | 'in-progress' | 'unread';

export type ReaderProgressAction =
  | { type: 'relocate'; location: ReaderRelocation; now?: number }
  | {
      type: 'navigate';
      source: Exclude<ReaderNavigationSource, 'finish'>;
      fromSpineIndex: number;
      destinationSpineIndex: number;
      now?: number;
    }
  | { type: 'finish'; spineIndex: number; now?: number };

function clampFraction(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function boundedText(value: string | undefined, maximum: number): string | undefined {
  if (!value) return undefined;
  const text = [...value.replace(/\s+/g, ' ').trim()].slice(0, maximum).join('');
  return text || undefined;
}

export function sanitizeReaderLocator(locator: ReaderLocator): ReaderLocator {
  const href = boundedText(locator.href, 2_048) ?? `spine:${locator.spineIndex}`;
  const cfi = boundedText(locator.cfi, 2_048);
  const textQuote = boundedText(locator.textQuote, 240);
  return {
    spineIndex: Math.max(0, Math.trunc(locator.spineIndex)),
    href,
    fractionInChapter: clampFraction(locator.fractionInChapter),
    ...(cfi ? { cfi } : {}),
    ...(textQuote ? { textQuote } : {}),
  };
}

function validLinearIndices(indices: number[]): number[] {
  return [...new Set(indices.filter((index) => Number.isInteger(index) && index >= 0))].sort(
    (left, right) => left - right,
  );
}

export function createReaderProgress(
  linearSpineIndices: number[],
  stored?: StoredReaderProgress,
  fallbackLocation?: ReaderRelocation,
): ReaderProgressState {
  const linear = validLinearIndices(linearSpineIndices);
  const allowed = new Set(linear);
  const fallbackIndex =
    fallbackLocation && allowed.has(fallbackLocation.spineIndex)
      ? fallbackLocation.spineIndex
      : (linear[0] ?? 0);
  const storedIndex = stored?.currentSpineIndex;
  const currentSpineIndex =
    storedIndex !== undefined && allowed.has(storedIndex) ? storedIndex : fallbackIndex;
  const positions: Record<string, ReaderLocator> = {};

  for (const [key, locator] of Object.entries(stored?.positions ?? {})) {
    if (allowed.has(locator.spineIndex) && String(locator.spineIndex) === key) {
      positions[key] = sanitizeReaderLocator(locator);
    }
  }
  if (fallbackLocation && allowed.has(fallbackLocation.spineIndex)) {
    positions[String(fallbackLocation.spineIndex)] = sanitizeReaderLocator(fallbackLocation);
  }

  const completedSpineIndices = validLinearIndices(stored?.completedSpineIndices ?? []).filter(
    (index) => allowed.has(index),
  );
  return {
    schemaVersion: 1,
    linearSpineIndices: linear,
    currentSpineIndex,
    completedSpineIndices,
    positions,
    finished:
      Boolean(stored?.finished) &&
      linear.length > 0 &&
      completedSpineIndices.length === linear.length,
    updatedAt: Math.max(0, stored?.updatedAt ?? Date.now()),
  };
}

export function readerProgressReducer(
  state: ReaderProgressState,
  action: ReaderProgressAction,
): ReaderProgressState {
  const now = Math.max(0, action.now ?? Date.now());

  if (action.type === 'relocate') {
    const location = sanitizeReaderLocator(action.location);
    if (!state.linearSpineIndices.includes(location.spineIndex)) return state;
    return {
      ...state,
      currentSpineIndex: location.spineIndex,
      positions: { ...state.positions, [String(location.spineIndex)]: location },
      updatedAt: now,
    };
  }

  if (action.type === 'finish') {
    if (!state.linearSpineIndices.includes(action.spineIndex)) return state;
    const finalIndex = state.linearSpineIndices.at(-1);
    if (action.spineIndex !== finalIndex) return state;
    return {
      ...state,
      currentSpineIndex: action.spineIndex,
      completedSpineIndices: [...state.linearSpineIndices],
      finished: true,
      updatedAt: now,
    };
  }

  const shouldComplete = action.source === 'next';
  const completedSpineIndices = shouldComplete
    ? validLinearIndices([...state.completedSpineIndices, action.fromSpineIndex]).filter((index) =>
        state.linearSpineIndices.includes(index),
      )
    : state.completedSpineIndices;
  return {
    ...state,
    currentSpineIndex: state.linearSpineIndices.includes(action.destinationSpineIndex)
      ? action.destinationSpineIndex
      : state.currentSpineIndex,
    completedSpineIndices,
    updatedAt: now,
  };
}

export function storedReaderProgress(state: ReaderProgressState): StoredReaderProgress {
  return {
    schemaVersion: state.schemaVersion,
    currentSpineIndex: state.currentSpineIndex,
    completedSpineIndices: state.completedSpineIndices,
    positions: state.positions,
    finished: state.finished,
    updatedAt: state.updatedAt,
  };
}

export function overallProgress(state: ReaderProgressState): number {
  if (!state.linearSpineIndices.length) return 0;
  if (state.finished) return 1;
  return Math.min(1, state.completedSpineIndices.length / state.linearSpineIndices.length);
}

export function chapterProgressState(
  state: ReaderProgressState,
  spineIndex: number,
): ChapterProgressState {
  if (state.completedSpineIndices.includes(spineIndex)) return 'completed';
  return state.currentSpineIndex === spineIndex ? 'in-progress' : 'unread';
}
