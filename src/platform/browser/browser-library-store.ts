import { z } from 'zod';

import {
  PlatformOperationError,
  type PublicationDescriptor,
  type PublicationLibraryUpdate,
} from '../contracts';

export const BROWSER_LIBRARY_DATABASE = 'novelreaper-library';
export const MAX_LOCAL_BOOKS = 100;
export const MAX_LOCAL_EPUB_BYTES = 512 * 1024 * 1024;
export const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const bookSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string().min(1).max(240),
    fileSize: z.number().int().positive().max(MAX_LOCAL_EPUB_BYTES),
    lastModified: z.number().int().nonnegative(),
    mimeType: z.string().max(120),
    availability: z.enum(['stored', 'reselect-required']),
    contentHash: contentHashSchema.optional(),
    title: z.string().min(1).max(300).optional(),
    author: z.string().min(1).max(300).optional(),
    spineLength: z.number().int().positive().max(100_000).optional(),
    lastOpenedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

export interface BrowserLibraryStorage {
  initialize: (legacy: PublicationDescriptor[]) => Promise<void>;
  list: () => Promise<PublicationDescriptor[]>;
  save: (book: PublicationDescriptor, file: File) => Promise<PublicationDescriptor>;
  readFile: (id: string) => Promise<{ book: PublicationDescriptor; file: File } | undefined>;
  update: (id: string, update: PublicationLibraryUpdate) => Promise<PublicationDescriptor[]>;
  remove: (id: string) => Promise<PublicationDescriptor[]>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser storage request failed.'));
  });
}

function sortedBooks(records: unknown[]): PublicationDescriptor[] {
  return records
    .map(normalizedBook)
    .sort((left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0));
}

function normalizedBook(record: unknown): PublicationDescriptor {
  const book = bookSchema.parse(record);
  return {
    id: book.id,
    displayName: book.displayName,
    fileSize: book.fileSize,
    lastModified: book.lastModified,
    mimeType: book.mimeType,
    availability: book.availability,
    ...(book.contentHash ? { contentHash: book.contentHash } : {}),
    ...(book.title ? { title: book.title } : {}),
    ...(book.author ? { author: book.author } : {}),
    ...(book.spineLength ? { spineLength: book.spineLength } : {}),
    ...(book.lastOpenedAt !== undefined ? { lastOpenedAt: book.lastOpenedAt } : {}),
  };
}

export async function fingerprintEpub(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Local browser database only. Metadata and EPUB bytes commit/remove together. */
export class BrowserLibraryStore implements BrowserLibraryStorage {
  public constructor(private readonly factory: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = this.factory.open(BROWSER_LIBRARY_DATABASE, 1);
      let abandoned = false;
      const timeout = setTimeout(() => {
        abandoned = true;
        reject(
          new Error(
            'Browser storage did not open in time. Close other NovelReaper tabs and retry.',
          ),
        );
      }, 5000);
      request.onupgradeneeded = () => {
        if (abandoned) {
          request.transaction?.abort();
          return;
        }
        const db = request.result;
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('contentHash', 'contentHash', { unique: true });
        db.createObjectStore('files');
        db.createObjectStore('state');
      };
      request.onsuccess = () => {
        clearTimeout(timeout);
        const db = request.result;
        db.onversionchange = () => db.close();
        if (abandoned) db.close();
        else resolve(db);
      };
      request.onerror = () => {
        clearTimeout(timeout);
        reject(request.error ?? new Error('Browser storage is unavailable.'));
      };
      request.onblocked = () => {
        abandoned = true;
        clearTimeout(timeout);
        reject(new Error('Close other NovelReaper tabs to unlock browser storage.'));
      };
    });
  }

  private async transaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    work: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> {
    const db = await this.open();
    try {
      const tx = db.transaction(stores, mode);
      const complete = new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () =>
          reject(tx.error ?? new Error('Browser storage transaction was cancelled.'));
      });
      try {
        // Work awaits only IndexedDB requests so the transaction stays active.
        const [result] = await Promise.all([work(tx), complete]);
        return result;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* Already committed or aborted. */
        }
        throw error;
      }
    } finally {
      db.close();
    }
  }

  public async initialize(legacy: PublicationDescriptor[]): Promise<void> {
    await this.transaction(['books', 'state'], 'readwrite', async (tx) => {
      const state = tx.objectStore('state');
      if (await requestResult(state.get('legacy-imported'))) return;
      const books = tx.objectStore('books');
      for (const entry of legacy.slice(0, MAX_LOCAL_BOOKS)) {
        if (!(await requestResult(books.get(entry.id)))) {
          await requestResult(
            books.put(bookSchema.parse({ ...entry, availability: 'reselect-required' })),
          );
        }
      }
      await requestResult(state.put(true, 'legacy-imported'));
    });
  }

  public list(): Promise<PublicationDescriptor[]> {
    return this.transaction(['books'], 'readonly', async (tx) =>
      sortedBooks(await requestResult<unknown[]>(tx.objectStore('books').getAll())),
    );
  }

  public save(book: PublicationDescriptor, file: File): Promise<PublicationDescriptor> {
    const parsed = bookSchema.parse({ ...book, availability: 'stored' });
    contentHashSchema.parse(parsed.contentHash);
    return this.transaction(['books', 'files'], 'readwrite', async (tx) => {
      const books = tx.objectStore('books');
      const duplicate: unknown = await requestResult(
        books.index('contentHash').get(parsed.contentHash!),
      );
      const existing = duplicate ? bookSchema.parse(duplicate) : undefined;
      const saved = existing
        ? {
            ...parsed,
            ...existing,
            lastOpenedAt: parsed.lastOpenedAt ?? Date.now(),
            availability: 'stored' as const,
          }
        : parsed;
      if (
        !existing &&
        !(await requestResult(books.get(saved.id))) &&
        (await requestResult(books.count())) >= MAX_LOCAL_BOOKS
      ) {
        throw new PlatformOperationError(
          'LIBRARY_FULL',
          'Your local library has 100 books. Remove a saved copy before importing another.',
        );
      }
      await requestResult(tx.objectStore('files').put(file, saved.id));
      await requestResult(books.put(saved));
      return normalizedBook(saved);
    });
  }

  public readFile(id: string): Promise<{ book: PublicationDescriptor; file: File } | undefined> {
    return this.transaction(['books', 'files'], 'readonly', async (tx) => {
      const record: unknown = await requestResult(tx.objectStore('books').get(id));
      if (!record) return undefined;
      const book = normalizedBook(record);
      const blob: unknown = await requestResult(tx.objectStore('files').get(id));
      if (!(blob instanceof Blob) || blob.size !== book.fileSize) return undefined;
      return {
        book,
        file: new File([blob], book.displayName, {
          type: book.mimeType,
          lastModified: book.lastModified,
        }),
      };
    });
  }

  public update(id: string, update: PublicationLibraryUpdate): Promise<PublicationDescriptor[]> {
    return this.transaction(['books'], 'readwrite', async (tx) => {
      const books = tx.objectStore('books');
      const record: unknown = await requestResult(books.get(id));
      if (record)
        await requestResult(
          books.put(bookSchema.parse({ ...bookSchema.parse(record), ...update })),
        );
      return sortedBooks(await requestResult<unknown[]>(books.getAll()));
    });
  }

  public remove(id: string): Promise<PublicationDescriptor[]> {
    return this.transaction(['books', 'files'], 'readwrite', async (tx) => {
      await requestResult(tx.objectStore('files').delete(id));
      await requestResult(tx.objectStore('books').delete(id));
      return sortedBooks(await requestResult<unknown[]>(tx.objectStore('books').getAll()));
    });
  }
}
