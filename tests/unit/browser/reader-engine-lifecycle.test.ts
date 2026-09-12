import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliateBook } from 'foliate-js/view.js';

import { FoliateReaderEngine } from '../../../src/reader/FoliateReaderEngine';

const { makeBook } = vi.hoisted(() => ({ makeBook: vi.fn() }));
vi.mock('foliate-js/view.js', () => ({ makeBook }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeBook(): FoliateBook {
  return {
    metadata: { title: 'Lifecycle test' },
    sections: [{ id: 'one', linear: 'yes', load: vi.fn(), unload: vi.fn() }],
    toc: [],
    destroy: vi.fn(),
  } as unknown as FoliateBook;
}

describe('reader engine teardown', () => {
  beforeEach(() => makeBook.mockReset());

  it('discards a parsed book that arrives after destruction', async () => {
    const parsed = deferred<FoliateBook>();
    makeBook.mockReturnValue(parsed.promise);
    const engine = new FoliateReaderEngine();
    const host = document.createElement('div');
    const opening = engine.open(new File(['book'], 'test.epub'), host);
    const cancelled = expect(opening).rejects.toMatchObject({ code: 'OPEN_FAILED' });
    await vi.waitFor(() => expect(makeBook).toHaveBeenCalledOnce());
    engine.destroy();
    const book = fakeBook();
    parsed.resolve(book);
    await cancelled;
    expect(book.destroy).toHaveBeenCalledOnce();
    expect(host.childElementCount).toBe(0);
  });

  it('does not create a cover URL or frame when a cover finishes after destruction', async () => {
    const cover = deferred<Blob>();
    const book = fakeBook();
    book.getCover = vi.fn(() => cover.promise);
    makeBook.mockResolvedValue(book);
    const engine = new FoliateReaderEngine();
    const host = document.createElement('div');
    const opening = engine.open(new File(['book'], 'test.epub'), host);
    const cancelled = expect(opening).rejects.toMatchObject({ code: 'OPEN_FAILED' });
    await vi.waitFor(() => expect(book.getCover).toHaveBeenCalledOnce());
    engine.destroy();
    cover.resolve(new Blob(['cover'], { type: 'image/png' }));
    await cancelled;
    expect(book.destroy).toHaveBeenCalledOnce();
    expect(host.childElementCount).toBe(0);
  });

  it('an old open failure cannot destroy a newer opening on the same engine', async () => {
    const oldParse = deferred<FoliateBook>();
    const newCover = deferred<Blob>();
    const book = fakeBook();
    book.getCover = vi.fn(() => newCover.promise);
    makeBook.mockReturnValueOnce(oldParse.promise).mockResolvedValueOnce(book);
    const engine = new FoliateReaderEngine();
    const oldOpening = engine.open(new File(['old'], 'old.epub'), document.createElement('div'));
    const oldCancelled = expect(oldOpening).rejects.toMatchObject({ code: 'OPEN_FAILED' });
    await vi.waitFor(() => expect(makeBook).toHaveBeenCalledOnce());
    const newOpening = engine.open(new File(['new'], 'new.epub'), document.createElement('div'));
    const newCancelled = expect(newOpening).rejects.toMatchObject({ code: 'OPEN_FAILED' });
    await vi.waitFor(() => expect(book.getCover).toHaveBeenCalledOnce());
    oldParse.reject(new Error('Old parsing failed'));
    await oldCancelled;
    expect(book.destroy).not.toHaveBeenCalled();
    engine.destroy();
    newCover.resolve(new Blob());
    await newCancelled;
    expect(book.destroy).toHaveBeenCalledOnce();
  });

  it('rejects a pending frame load immediately when the reader is destroyed', async () => {
    const book = fakeBook();
    vi.mocked(book.sections[0]!.load).mockResolvedValue('blob:pending-chapter');
    makeBook.mockResolvedValue(book);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html><head></head><body><p>Pending frame</p></body></html>', {
        headers: { 'content-type': 'text/html' },
      }),
    );
    const engine = new FoliateReaderEngine();
    const host = document.createElement('div');
    const opening = engine.open(new File(['book'], 'test.epub'), host);
    const cancelled = expect(opening).rejects.toMatchObject({ code: 'OPEN_FAILED' });
    await vi.waitFor(() => expect(host.querySelector('iframe')?.srcdoc).toContain('Pending frame'));
    engine.destroy();
    await cancelled;
    expect(host.childElementCount).toBe(0);
    expect(book.destroy).toHaveBeenCalledOnce();
  });
});
