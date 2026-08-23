import { beforeEach, describe, expect, it } from 'vitest';

import {
  BROWSER_PREVIEW_STORAGE_KEY,
  BrowserPlatformAdapter,
  MAX_BROWSER_EPUB_BYTES,
} from '../../../src/platform/browser/browser-platform';
import type { PlatformOperationError } from '../../../src/platform/contracts';

function epubFile(name = 'Novel.epub'): File {
  return new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])], name, {
    type: 'application/epub+zip',
    lastModified: 1_700_000_000_000,
  });
}

function adapterFor(file?: File): BrowserPlatformAdapter {
  return new BrowserPlatformAdapter({
    document,
    storage: window.localStorage,
    pickFile: () => Promise.resolve(file),
    createId: () => 'f4cc55dc-c548-4780-b384-0c663bfdb14f',
  });
}

describe('BrowserPlatformAdapter', () => {
  beforeEach(() => window.localStorage.clear());

  it('validates and retains a selected EPUB only in the active session', async () => {
    const result = await adapterFor(epubFile()).selectPublication();

    expect(result.status).toBe('selected');
    if (result.status !== 'selected') throw new Error('Expected a selected publication.');
    expect(result.publication.file).toBeInstanceOf(File);
    expect(result.publication.availability).toBe('selected');

    const stored = JSON.parse(
      window.localStorage.getItem(BROWSER_PREVIEW_STORAGE_KEY) ?? '{}',
    ) as Record<string, unknown>;
    expect(JSON.stringify(stored)).not.toContain('sourcePath');
    expect(JSON.stringify(stored)).not.toContain('file:');

    const nextSession = await adapterFor().getBootstrapState();
    expect(nextSession.library).toHaveLength(1);
    expect(nextSession.recentPublication).toMatchObject({
      displayName: 'Novel.epub',
      availability: 'reselect-required',
    });
  });

  it('updates, orders, and removes remembered library cards without source paths', async () => {
    const adapter = adapterFor(epubFile('First.epub'));
    const selected = await adapter.selectPublication();
    if (selected.status !== 'selected') throw new Error('Expected a selected publication.');

    const updated = await adapter.updateLibraryPublication(selected.publication.id, {
      title: 'First Volume',
      author: 'Calm Author',
      spineLength: 4200,
      lastOpenedAt: 1_800_000_000_000,
    });
    expect(updated[0]).toMatchObject({
      title: 'First Volume',
      author: 'Calm Author',
      spineLength: 4200,
    });
    expect(JSON.stringify(window.localStorage)).not.toContain('sourcePath');

    await expect(adapter.removeLibraryPublication(selected.publication.id)).resolves.toEqual([]);
    expect((await adapter.getBootstrapState()).library).toEqual([]);
  });

  it('treats picker cancellation as a neutral result', async () => {
    await expect(adapterFor().selectPublication()).resolves.toEqual({
      status: 'cancelled',
    });
  });

  it('rejects misleading extensions and invalid ZIP signatures', async () => {
    await expect(adapterFor(epubFile('Novel.zip')).selectPublication()).rejects.toMatchObject({
      code: 'INVALID_EPUB_EXTENSION',
    } satisfies Partial<PlatformOperationError>);

    const invalid = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], 'Novel.epub');
    await expect(adapterFor(invalid).selectPublication()).rejects.toMatchObject({
      code: 'INVALID_ZIP_SIGNATURE',
    } satisfies Partial<PlatformOperationError>);
  });

  it('rejects an EPUB beyond the bounded browser-preview size', async () => {
    const oversized = epubFile();
    Object.defineProperty(oversized, 'size', {
      configurable: true,
      value: MAX_BROWSER_EPUB_BYTES + 1,
    });

    await expect(adapterFor(oversized).selectPublication()).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    } satisfies Partial<PlatformOperationError>);
  });

  it('resets invalid preview state without breaking bootstrap', async () => {
    window.localStorage.setItem(BROWSER_PREVIEW_STORAGE_KEY, '{"schemaVersion":99}');
    const state = await adapterFor().getBootstrapState();

    expect(state.recentPublication).toBeUndefined();
    expect(state.notices).toContain('Invalid browser preview state was reset safely.');
    expect(window.localStorage.getItem(BROWSER_PREVIEW_STORAGE_KEY)).toBeNull();
  });
});
