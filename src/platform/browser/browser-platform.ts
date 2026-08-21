import { z } from 'zod';

import type { ReaderBounds, ReaderStateSnapshot } from '../../shared/contracts/ipc';
import {
  PlatformOperationError,
  type NovelReaperPlatform,
  type PlatformBootstrapState,
  type PlatformCapabilities,
  type PublicationDescriptor,
  type PublicationSelectionResult,
  type SelectedPublication,
} from '../contracts';

export const MAX_BROWSER_EPUB_BYTES = 512 * 1024 * 1024;
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
  })
  .strict();

const browserPreviewStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    recentPublication: storedPublicationSchema.optional(),
  })
  .strict();

type StoredPublication = z.infer<typeof storedPublicationSchema>;

interface BrowserPlatformDependencies {
  document: Document;
  storage?: Storage;
  pickFile?: () => Promise<File | undefined>;
  createId?: () => string;
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
  };
}

function unavailablePublication(stored: StoredPublication): PublicationDescriptor {
  return { ...stored };
}

export class BrowserPlatformAdapter implements NovelReaperPlatform {
  public readonly environment = 'browser-preview' as const;
  public readonly capabilities: PlatformCapabilities;

  private readonly document: Document;
  private readonly storage: Storage | undefined;
  private readonly pickFile: () => Promise<File | undefined>;
  private readonly createId: () => string;

  public constructor(dependencies: BrowserPlatformDependencies) {
    this.document = dependencies.document;
    this.storage = dependencies.storage;
    this.pickFile = dependencies.pickFile ?? createFilePicker(dependencies.document);
    this.createId = dependencies.createId ?? (() => crypto.randomUUID());
    this.capabilities = Object.freeze({
      selectLocalPublication: true,
      durableSourceAccess: false,
      relink: false,
      nativeWindowControls: false,
      fullscreen: typeof dependencies.document.documentElement.requestFullscreen === 'function',
    });
  }

  public getBootstrapState(): Promise<PlatformBootstrapState> {
    const notices: string[] = [];
    let recentPublication: PublicationDescriptor | undefined;

    if (this.storage) {
      try {
        const serialized = this.storage.getItem(BROWSER_PREVIEW_STORAGE_KEY);
        if (serialized) {
          const parsed = browserPreviewStateSchema.safeParse(JSON.parse(serialized));
          if (parsed.success && parsed.data.recentPublication) {
            recentPublication = unavailablePublication(parsed.data.recentPublication);
          } else if (!parsed.success) {
            this.storage.removeItem(BROWSER_PREVIEW_STORAGE_KEY);
            notices.push('Invalid browser preview state was reset safely.');
          }
        }
      } catch {
        notices.push('Browser preview history is unavailable in this tab.');
      }
    }

    return Promise.resolve({
      appName: 'NovelReaper',
      appVersion: '0.1.0-preview',
      environment: this.environment,
      capabilities: this.capabilities,
      reader: { status: 'idle', generation: 0, canRetry: false },
      window: this.currentWindowState(),
      ...(recentPublication ? { recentPublication } : {}),
      notices,
    });
  }

  public async selectPublication(): Promise<PublicationSelectionResult> {
    const file = await this.pickFile();
    if (!file) return { status: 'cancelled' };

    await validateEpubFile(file);
    const publication: SelectedPublication = {
      id: this.createId(),
      displayName: boundedDisplayName(file.name),
      fileSize: file.size,
      lastModified: Math.max(0, Math.round(file.lastModified)),
      mimeType: file.type.slice(0, 120),
      availability: 'selected',
      file,
    };

    let warning: string | undefined;
    if (this.storage) {
      try {
        this.storage.setItem(
          BROWSER_PREVIEW_STORAGE_KEY,
          JSON.stringify({
            schemaVersion: 1,
            recentPublication: toStoredPublication(publication),
          }),
        );
      } catch {
        warning = 'The file is ready, but browser preview history could not be saved.';
      }
    }

    return {
      status: 'selected',
      publication,
      ...(warning ? { warning } : {}),
    };
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
  return new BrowserPlatformAdapter({ document, ...(storage ? { storage } : {}) });
}
