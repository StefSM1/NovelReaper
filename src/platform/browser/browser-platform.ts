import { z } from 'zod';
import { validateCustomTitle } from '../publication-title';
import {
  BrowserLibraryStore,
  fingerprintEpub,
  MAX_LOCAL_EPUB_BYTES,
  type BrowserLibraryStorage,
} from './browser-library-store';

import type { ReaderBounds, ReaderStateSnapshot } from '../../shared/contracts/ipc';
import {
  PlatformOperationError,
  type NovelReaperPlatform,
  type PlatformBootstrapState,
  type PlatformCapabilities,
  type PublicationDescriptor,
  type PublicationLibraryUpdate,
  type PublicationSelectionResult,
  type SelectedPublication,
} from '../contracts';

export const MAX_BROWSER_EPUB_BYTES = MAX_LOCAL_EPUB_BYTES;
export const BROWSER_PREVIEW_STORAGE_KEY = 'novelreaper:browser-preview:v1';

const ZIP_LOCAL_FILE_HEADER = [0x50, 0x4b, 0x03, 0x04] as const;

const storedPublicationSchema = z
  .object({
    id: z.string().uuid(),
    displayName: z.string().min(1).max(240),
    fileSize: z.number().int().positive().max(MAX_BROWSER_EPUB_BYTES),
    lastModified: z.number().int().nonnegative(),
    mimeType: z.string().max(120),
    availability: z.literal('reselect-required'),
    title: z.string().min(1).max(300).optional(),
    customTitle: z.string().trim().min(1).max(300).optional(),
    author: z.string().min(1).max(300).optional(),
    spineLength: z.number().int().positive().max(100_000).optional(),
    lastOpenedAt: z.number().int().nonnegative().optional(),
  })
  .strict();

const legacyBrowserPreviewStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    recentPublication: storedPublicationSchema.optional(),
  })
  .strict();

const browserPreviewStateSchema = z
  .object({
    schemaVersion: z.literal(2),
    publications: z.array(storedPublicationSchema).max(100),
  })
  .strict();

type StoredPublication = z.infer<typeof storedPublicationSchema>;

interface BrowserPlatformDependencies {
  document: Document;
  storage?: Storage;
  pickFile?: () => Promise<File | undefined>;
  createId?: () => string;
  libraryStore?: BrowserLibraryStorage;
  fingerprint?: (file: File) => Promise<string>;
}

function boundedDisplayName(name: string): string {
  const sanitized = [...name]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && codePoint !== 127;
    })
    .join('')
    .trim();
  return (sanitized || 'Untitled.epub').slice(0, 240);
}

function boundedMetadata(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = [...value.replace(/\s+/g, ' ').trim()].slice(0, 300).join('');
  return text || undefined;
}

function sameSource(
  publication: Pick<PublicationDescriptor, 'displayName' | 'fileSize' | 'lastModified'>,
  file: File,
): boolean {
  return (
    publication.displayName === boundedDisplayName(file.name) &&
    publication.fileSize === file.size &&
    publication.lastModified === Math.max(0, Math.round(file.lastModified))
  );
}

function sortLibrary(publications: StoredPublication[]): StoredPublication[] {
  return [...publications].sort(
    (left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0),
  );
}

async function validateEpubFile(file: File): Promise<void> {
  if (!file.name.toLocaleLowerCase().endsWith('.epub')) {
    throw new PlatformOperationError(
      'INVALID_EPUB_EXTENSION',
      'Choose a file whose name ends in .epub.',
    );
  }
  if (file.size === 0) {
    throw new PlatformOperationError('EMPTY_FILE', 'That EPUB file is empty.');
  }
  if (file.size > MAX_BROWSER_EPUB_BYTES) {
    throw new PlatformOperationError(
      'FILE_TOO_LARGE',
      'That EPUB is larger than the 512 MiB v1 preview limit.',
    );
  }

  const signature = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const hasZipSignature = ZIP_LOCAL_FILE_HEADER.every((byte, index) => signature[index] === byte);
  if (!hasZipSignature) {
    throw new PlatformOperationError(
      'INVALID_ZIP_SIGNATURE',
      'That file does not have the ZIP signature required by EPUB.',
    );
  }
}

function createFilePicker(document: Document): () => Promise<File | undefined> {
  return async () =>
    new Promise<File | undefined>((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.epub,application/epub+zip';
      input.hidden = true;

      let settled = false;
      const finish = (file?: File): void => {
        if (settled) return;
        settled = true;
        input.remove();
        resolve(file);
      };

      input.addEventListener('change', () => finish(input.files?.[0]), { once: true });
      input.addEventListener('cancel', () => finish(), { once: true });
      document.body.append(input);
      input.click();
    });
}

function toStoredPublication(publication: SelectedPublication): StoredPublication {
  return {
    id: publication.id,
    displayName: publication.displayName,
    fileSize: publication.fileSize,
    lastModified: publication.lastModified,
    mimeType: publication.mimeType,
    availability: 'reselect-required',
    ...(publication.title ? { title: publication.title } : {}),
    ...(publication.customTitle ? { customTitle: publication.customTitle } : {}),
    ...(publication.author ? { author: publication.author } : {}),
    ...(publication.spineLength ? { spineLength: publication.spineLength } : {}),
    ...(publication.lastOpenedAt === undefined ? {} : { lastOpenedAt: publication.lastOpenedAt }),
  };
}

function unavailablePublication(stored: StoredPublication): PublicationDescriptor {
  return {
    id: stored.id,
    displayName: stored.displayName,
    fileSize: stored.fileSize,
    lastModified: stored.lastModified,
    mimeType: stored.mimeType,
    availability: stored.availability,
    ...(stored.title ? { title: stored.title } : {}),
    ...(stored.customTitle ? { customTitle: stored.customTitle } : {}),
    ...(stored.author ? { author: stored.author } : {}),
    ...(stored.spineLength ? { spineLength: stored.spineLength } : {}),
    ...(stored.lastOpenedAt === undefined ? {} : { lastOpenedAt: stored.lastOpenedAt }),
  };
}

function readStoredLibrary(storage: Storage | undefined): {
  publications: StoredPublication[];
  warning?: string;
} {
  if (!storage) return { publications: [] };
  try {
    const serialized = storage.getItem(BROWSER_PREVIEW_STORAGE_KEY);
    if (!serialized) return { publications: [] };
    const data: unknown = JSON.parse(serialized);
    const current = browserPreviewStateSchema.safeParse(data);
    if (current.success) return { publications: sortLibrary(current.data.publications) };
    const legacy = legacyBrowserPreviewStateSchema.safeParse(data);
    if (legacy.success) {
      const publications = legacy.data.recentPublication ? [legacy.data.recentPublication] : [];
      storage.setItem(
        BROWSER_PREVIEW_STORAGE_KEY,
        JSON.stringify({ schemaVersion: 2, publications }),
      );
      return { publications };
    }
    storage.removeItem(BROWSER_PREVIEW_STORAGE_KEY);
    return { publications: [], warning: 'Invalid browser preview state was reset safely.' };
  } catch {
    return { publications: [], warning: 'Browser preview history is unavailable in this tab.' };
  }
}

function writeStoredLibrary(
  storage: Storage | undefined,
  publications: StoredPublication[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      BROWSER_PREVIEW_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 2, publications: sortLibrary(publications).slice(0, 100) }),
    );
    return true;
  } catch {
    return false;
  }
}

export class BrowserPlatformAdapter implements NovelReaperPlatform {
  public readonly environment = 'browser-preview' as const;
  public readonly capabilities: PlatformCapabilities;

  private readonly document: Document;
  private readonly storage: Storage | undefined;
  private readonly pickFile: () => Promise<File | undefined>;
  private readonly createId: () => string;
  private readonly libraryStore: BrowserLibraryStorage | undefined;
  private readonly fingerprint: (file: File) => Promise<string>;
  private libraryReady: Promise<void> | undefined;

  public constructor(dependencies: BrowserPlatformDependencies) {
    this.document = dependencies.document;
    this.storage = dependencies.storage;
    this.pickFile = dependencies.pickFile ?? createFilePicker(dependencies.document);
    this.createId = dependencies.createId ?? (() => crypto.randomUUID());
    this.libraryStore = dependencies.libraryStore;
    this.fingerprint = dependencies.fingerprint ?? fingerprintEpub;
    this.capabilities = Object.freeze({
      selectLocalPublication: true,
      durableSourceAccess: Boolean(this.libraryStore),
      relink: false,
      nativeWindowControls: false,
      fullscreen: typeof dependencies.document.documentElement.requestFullscreen === 'function',
    });
  }

  private async readyLibrary(): Promise<void> {
    if (!this.libraryStore) return;
    this.libraryReady ??= this.libraryStore.initialize(
      readStoredLibrary(this.storage).publications.map(unavailablePublication),
    );
    try {
      await this.libraryReady;
    } catch (error) {
      this.libraryReady = undefined;
      throw error;
    }
  }

  public async getBootstrapState(): Promise<PlatformBootstrapState> {
    const stored = readStoredLibrary(this.storage);
    let library = stored.publications.map(unavailablePublication);
    const notices = stored.warning ? [stored.warning] : [];
    if (this.libraryStore) {
      try {
        await this.readyLibrary();
        library = await this.libraryStore.list();
      } catch {
        notices.push(
          'Saved books are temporarily unavailable. Close other NovelReaper tabs and reload, or select an EPUB to read this session.',
        );
      }
    } else
      notices.push(
        'This browser cannot store EPUB copies. Files must be selected again after closing the tab.',
      );
    const recentPublication = library[0];

    return Promise.resolve({
      appName: 'NovelReaper',
      appVersion: '0.1.0-preview',
      environment: this.environment,
      capabilities: this.capabilities,
      reader: { status: 'idle', generation: 0, canRetry: false },
      window: this.currentWindowState(),
      library,
      ...(recentPublication ? { recentPublication } : {}),
      notices,
    });
  }

  public async selectPublication(): Promise<PublicationSelectionResult> {
    const file = await this.pickFile();
    if (!file) return { status: 'cancelled' };

    await validateEpubFile(file);
    if (this.libraryStore) {
      let descriptor: PublicationDescriptor = {
        id: this.createId(),
        displayName: boundedDisplayName(file.name),
        fileSize: file.size,
        lastModified: Math.max(0, Math.round(file.lastModified)),
        mimeType: file.type.slice(0, 120),
        availability: 'selected',
      };
      try {
        const contentHash = await this.fingerprint(file);
        descriptor = { ...descriptor, contentHash };
        await this.readyLibrary();
        const entries = await this.libraryStore.list();
        const existing =
          entries.find((entry) => entry.contentHash === contentHash) ??
          entries.find((entry) => !entry.contentHash && sameSource(entry, file));
        descriptor = {
          ...descriptor,
          ...existing,
          displayName: existing?.displayName ?? boundedDisplayName(file.name),
          fileSize: file.size,
          lastModified: existing?.lastModified ?? Math.max(0, Math.round(file.lastModified)),
          mimeType: file.type.slice(0, 120),
          availability: 'stored',
          contentHash,
          lastOpenedAt: Date.now(),
        };
        const saved = await this.libraryStore.save(descriptor, file);
        return {
          status: 'selected',
          publication: { ...saved, availability: 'selected', storedLocally: true, file },
        };
      } catch (error) {
        if (error instanceof PlatformOperationError && error.code === 'LIBRARY_FULL') throw error;
        // Reading remains possible without claiming that a failed import was saved.
        return {
          status: 'selected',
          publication: {
            ...descriptor,
            availability: 'selected',
            file,
          },
          warning:
            'The EPUB could not be saved on this device (storage may be full or blocked). This import is available for this session only. Any previously saved copies are unchanged.',
        };
      }
    }
    const stored = readStoredLibrary(this.storage);
    const existing = stored.publications.find((entry) => sameSource(entry, file));
    const publication: SelectedPublication = {
      id: existing?.id ?? this.createId(),
      displayName: boundedDisplayName(file.name),
      fileSize: file.size,
      lastModified: Math.max(0, Math.round(file.lastModified)),
      mimeType: file.type.slice(0, 120),
      availability: 'selected',
      file,
      lastOpenedAt: Date.now(),
      ...(existing?.title ? { title: existing.title } : {}),
      ...(existing?.customTitle ? { customTitle: existing.customTitle } : {}),
      ...(existing?.author ? { author: existing.author } : {}),
      ...(existing?.spineLength ? { spineLength: existing.spineLength } : {}),
    };

    let warning: string | undefined;
    const publications = [
      toStoredPublication(publication),
      ...stored.publications.filter((entry) => entry.id !== publication.id),
    ];
    if (!writeStoredLibrary(this.storage, publications)) {
      warning = 'The file is ready, but browser preview history could not be saved.';
    }

    return {
      status: 'selected',
      publication,
      ...(warning ? { warning } : {}),
    };
  }

  public async openPublication(id: string): Promise<PublicationSelectionResult> {
    if (!this.libraryStore)
      return { status: 'unsupported', reason: 'Select this EPUB again to read it.' };
    try {
      await this.readyLibrary();
      const saved = await this.libraryStore.readFile(id);
      if (!saved)
        throw new PlatformOperationError(
          'STORED_FILE_MISSING',
          'The saved EPUB is missing. Select the original file again; your progress is still kept separately.',
        );
      await validateEpubFile(saved.file);
      return {
        status: 'selected',
        publication: {
          ...saved.book,
          availability: 'selected',
          storedLocally: true,
          file: saved.file,
        },
      };
    } catch (error) {
      if (error instanceof PlatformOperationError) throw error;
      throw new PlatformOperationError(
        'STORAGE_UNAVAILABLE',
        'The saved EPUB could not be opened. Close other NovelReaper tabs and retry, or select the original file.',
      );
    }
  }

  public async updateLibraryPublication(
    id: string,
    update: PublicationLibraryUpdate,
  ): Promise<PublicationDescriptor[]> {
    if (update.customTitle !== undefined)
      update = { ...update, customTitle: validateCustomTitle(update.customTitle) };
    if (this.libraryStore)
      return this.readyLibrary().then(() => this.libraryStore!.update(id, update));
    const stored = readStoredLibrary(this.storage);
    const publications = stored.publications.map((entry) => {
      if (entry.id !== id) return entry;
      const title = boundedMetadata(update.title);
      const author = boundedMetadata(update.author);
      return {
        ...entry,
        ...(title ? { title } : {}),
        ...(update.customTitle !== undefined ? { customTitle: update.customTitle } : {}),
        ...(author ? { author } : {}),
        ...(update.spineLength && update.spineLength <= 100_000
          ? { spineLength: Math.round(update.spineLength) }
          : {}),
        ...(update.lastOpenedAt === undefined
          ? {}
          : { lastOpenedAt: Math.max(0, Math.round(update.lastOpenedAt)) }),
      };
    });
    if (!writeStoredLibrary(this.storage, publications)) {
      return Promise.reject(
        new PlatformOperationError('STORAGE_UNAVAILABLE', 'Library metadata could not be saved.'),
      );
    }
    return Promise.resolve(sortLibrary(publications).map(unavailablePublication));
  }

  public removeLibraryPublication(id: string): Promise<PublicationDescriptor[]> {
    if (this.libraryStore) return this.readyLibrary().then(() => this.libraryStore!.remove(id));
    const stored = readStoredLibrary(this.storage);
    const publications = stored.publications.filter((entry) => entry.id !== id);
    if (!writeStoredLibrary(this.storage, publications)) {
      return Promise.reject(
        new PlatformOperationError(
          'STORAGE_UNAVAILABLE',
          'That library card could not be removed.',
        ),
      );
    }
    return Promise.resolve(sortLibrary(publications).map(unavailablePublication));
  }

  public setReaderBounds(bounds: ReaderBounds): Promise<void> {
    // The browser reading surface participates in normal DOM layout.
    void bounds;
    return Promise.resolve();
  }

  public recoverReader(): Promise<ReaderStateSnapshot> {
    return Promise.resolve({ status: 'idle', generation: 0, canRetry: false });
  }

  public async toggleFullscreen(): Promise<{ isMaximized: false; isFullScreen: boolean }> {
    if (!this.capabilities.fullscreen) {
      throw new PlatformOperationError(
        'UNSUPPORTED_FEATURE',
        'Fullscreen is not available in this browser preview.',
      );
    }

    if (this.document.fullscreenElement) {
      await this.document.exitFullscreen();
    } else {
      await this.document.documentElement.requestFullscreen();
    }
    return this.currentWindowState();
  }

  public onReaderState(listener: (state: ReaderStateSnapshot) => void): () => void {
    void listener;
    return () => undefined;
  }

  public onWindowState(
    listener: (state: { isMaximized: false; isFullScreen: boolean }) => void,
  ): () => void {
    const handleChange = (): void => listener(this.currentWindowState());
    this.document.addEventListener('fullscreenchange', handleChange);
    return () => this.document.removeEventListener('fullscreenchange', handleChange);
  }

  public onExitFocusRequested(listener: () => void): () => void {
    void listener;
    return () => undefined;
  }

  private currentWindowState(): { isMaximized: false; isFullScreen: boolean } {
    return {
      isMaximized: false,
      isFullScreen: this.document.fullscreenElement !== null,
    };
  }
}

export function createBrowserPlatform(): BrowserPlatformAdapter {
  let storage: Storage | undefined;
  try {
    storage = window.localStorage;
  } catch {
    storage = undefined;
  }
  let factory: IDBFactory | undefined;
  try {
    factory = window.indexedDB;
  } catch {
    factory = undefined;
  }
  return new BrowserPlatformAdapter({
    document,
    ...(storage ? { storage } : {}),
    ...(factory ? { libraryStore: new BrowserLibraryStore(factory) } : {}),
  });
}
