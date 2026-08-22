import { describe, expect, it, vi } from 'vitest';

import {
  browserProgressStorageKey,
  BrowserProgressStore,
  DebouncedProgressWriter,
} from '../../../src/platform/browser/browser-progress-store';
import type { SelectedPublication } from '../../../src/platform/contracts';
import type { StoredReaderProgress } from '../../../src/reader/progress-state';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  public get length(): number {
    return this.values.size;
  }
  public clear(): void {
    this.values.clear();
  }
  public getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  public key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  public removeItem(key: string): void {
    this.values.delete(key);
  }
  public setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const publication: SelectedPublication = {
  id: 'f4cc55dc-c548-4780-b384-0c663bfdb14f',
  displayName: 'Calm.epub',
  fileSize: 42,
  lastModified: 100,
  mimeType: 'application/epub+zip',
  availability: 'selected',
  file: new File(['book'], 'Calm.epub'),
};

const progress: StoredReaderProgress = {
  schemaVersion: 1,
  currentSpineIndex: 2,
  completedSpineIndices: [1],
  positions: {
    '2': { spineIndex: 2, href: 'text/two.xhtml', fractionInChapter: 0.4 },
  },
  finished: false,
  updatedAt: 10,
};

describe('browser progress persistence', () => {
  it('uses a stable file descriptor key and restores valid state', () => {
    const storage = new MemoryStorage();
    const key = browserProgressStorageKey(publication);
    const store = new BrowserProgressStore(storage, key);

    expect(store.save(progress)).toBe(true);
    expect(store.load()).toEqual(progress);
    expect(browserProgressStorageKey({ ...publication, id: crypto.randomUUID() })).toBe(key);
  });

  it('flushes the latest debounced state on disposal', () => {
    vi.useFakeTimers();
    const store = new BrowserProgressStore(
      new MemoryStorage(),
      browserProgressStorageKey(publication),
    );
    const writer = new DebouncedProgressWriter(store, vi.fn(), 500);
    const save = vi.spyOn(store, 'save');

    writer.schedule(progress);
    expect(save).not.toHaveBeenCalled();
    writer.dispose();
    expect(save).toHaveBeenCalledWith(progress);
    vi.useRealTimers();
  });

  it('resets malformed progress and exposes a recoverable warning', () => {
    const storage = new MemoryStorage();
    const key = browserProgressStorageKey(publication);
    storage.setItem(key, JSON.stringify({ schemaVersion: 99, positions: 'unsafe' }));
    const store = new BrowserProgressStore(storage, key);

    expect(store.load()).toBeUndefined();
    expect(store.takeLoadWarning()).toBe('Invalid saved reading progress was reset safely.');
    expect(store.takeLoadWarning()).toBeUndefined();
    expect(storage.getItem(key)).toBeNull();
  });
});
