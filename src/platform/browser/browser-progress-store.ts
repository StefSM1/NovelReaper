import { z } from 'zod';

import type { SelectedPublication } from '../contracts';
import type { StoredReaderProgress } from '../../reader/progress-state';

const locatorSchema = z
  .object({
    spineIndex: z.number().int().nonnegative().max(100_000),
    href: z.string().min(1).max(2_048),
    fractionInChapter: z.number().min(0).max(1),
    cfi: z.string().min(1).max(2_048).optional(),
    textQuote: z.string().min(1).max(240).optional(),
  })
  .strict();

const storedProgressSchema = z
  .object({
    schemaVersion: z.literal(1),
    currentSpineIndex: z.number().int().nonnegative().max(100_000),
    completedSpineIndices: z.array(z.number().int().nonnegative().max(100_000)).max(10_000),
    positions: z.record(z.string(), locatorSchema),
    finished: z.boolean(),
    updatedAt: z.number().nonnegative(),
  })
  .strict();

export function browserProgressStorageKey(publication: SelectedPublication): string {
  const name = encodeURIComponent(publication.displayName).slice(0, 180);
  return `novelreaper:browser-progress:v1:${name}:${publication.fileSize}:${publication.lastModified}`;
}

export class BrowserProgressStore {
  private loadWarning: string | undefined;

  public constructor(
    private readonly storage: Storage | undefined,
    private readonly key: string,
  ) {}

  public load(): StoredReaderProgress | undefined {
    if (!this.storage) return undefined;
    try {
      const value = this.storage.getItem(this.key);
      if (!value) return undefined;
      const parsed = storedProgressSchema.safeParse(JSON.parse(value));
      if (parsed.success) {
        const positions = Object.fromEntries(
          Object.entries(parsed.data.positions).map(([key, locator]) => [
            key,
            {
              spineIndex: locator.spineIndex,
              href: locator.href,
              fractionInChapter: locator.fractionInChapter,
              ...(locator.cfi ? { cfi: locator.cfi } : {}),
              ...(locator.textQuote ? { textQuote: locator.textQuote } : {}),
            },
          ]),
        );
        return { ...parsed.data, positions };
      }
      this.storage.removeItem(this.key);
      this.loadWarning = 'Invalid saved reading progress was reset safely.';
      return undefined;
    } catch {
      this.loadWarning = 'Saved reading progress is unavailable in this browser session.';
      return undefined;
    }
  }

  public takeLoadWarning(): string | undefined {
    const warning = this.loadWarning;
    this.loadWarning = undefined;
    return warning;
  }

  public save(progress: StoredReaderProgress): boolean {
    if (!this.storage) return false;
    try {
      this.storage.setItem(this.key, JSON.stringify(progress));
      return true;
    } catch {
      return false;
    }
  }
}

export class DebouncedProgressWriter {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: StoredReaderProgress | undefined;

  public constructor(
    private readonly store: BrowserProgressStore,
    private readonly onSaveError: () => void,
    private readonly delayMs = 450,
  ) {}

  public schedule(progress: StoredReaderProgress): void {
    this.pending = progress;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delayMs);
  }

  public flush(progress?: StoredReaderProgress): void {
    if (progress) this.pending = progress;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = undefined;
    if (!this.store.save(pending)) this.onSaveError();
  }

  public dispose(): void {
    this.flush();
  }
}
