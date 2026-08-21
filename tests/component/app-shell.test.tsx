import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type {
  NovelReaperPlatform,
  PlatformCapabilities,
  PublicationSelectionResult,
} from '../../src/platform/contracts';
import { PlatformOperationError } from '../../src/platform/contracts';
import { App } from '../../src/renderer/app/App';
import type { ReaderStateSnapshot, WindowStateSnapshot } from '../../src/shared/contracts/ipc';

interface FakePlatform extends NovelReaperPlatform {
  publishReader: (state: ReaderStateSnapshot) => void;
  publishWindow: (state: WindowStateSnapshot) => void;
}

function createPlatform(options?: {
  environment?: 'browser-preview' | 'electron';
  selection?: PublicationSelectionResult;
}): FakePlatform {
  let readerListener: ((state: ReaderStateSnapshot) => void) | undefined;
  let windowListener: ((state: WindowStateSnapshot) => void) | undefined;
  const environment = options?.environment ?? 'electron';
  const capabilities: PlatformCapabilities = {
    selectLocalPublication: environment === 'browser-preview',
    durableSourceAccess: false,
    relink: false,
    nativeWindowControls: environment === 'electron',
    fullscreen: true,
  };

  return {
    environment,
    capabilities,
    getBootstrapState: vi.fn().mockResolvedValue({
      appName: 'NovelReaper',
      appVersion: '0.1.0',
      environment,
      capabilities,
      reader: {
        status: environment === 'electron' ? 'ready' : 'idle',
        generation: 1,
        canRetry: false,
      },
      window: { isMaximized: false, isFullScreen: false },
      notices: [],
    }),
    selectPublication: vi.fn().mockResolvedValue(
      options?.selection ?? {
        status: 'unsupported',
        reason: 'Not available in this test adapter.',
      },
    ),
    setReaderBounds: vi.fn().mockResolvedValue(undefined),
    recoverReader: vi.fn().mockResolvedValue({ status: 'ready', generation: 2, canRetry: false }),
    toggleFullscreen: vi.fn().mockResolvedValue({ isMaximized: false, isFullScreen: true }),
    onReaderState: vi.fn((listener) => {
      readerListener = listener;
      return () => {
        readerListener = undefined;
      };
    }),
    onWindowState: vi.fn((listener) => {
      windowListener = listener;
      return () => {
        windowListener = undefined;
      };
    }),
    onExitFocusRequested: vi.fn(() => () => undefined),
    publishReader: (state) => readerListener?.(state),
    publishWindow: (state) => windowListener?.(state),
  };
}

describe('shared NovelReaper application shell', () => {
  it('retains the bounded Electron shell controls', async () => {
    const user = userEvent.setup();
    const platform = createPlatform();
    render(<App platform={platform} />);

    expect(await screen.findByText('Secure reader shell')).toBeVisible();
    expect(screen.getByTestId('reader-frame')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
    expect(platform.toggleFullscreen).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: 'Exit fullscreen' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Focus mode' }));
    expect(screen.getByRole('button', { name: 'Exit focus · Esc' })).toBeVisible();
  });

  it('accepts a browser-selected publication without Electron', async () => {
    const user = userEvent.setup();
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'Calm.epub', {
      type: 'application/epub+zip',
      lastModified: 1_700_000_000_000,
    });
    const platform = createPlatform({
      environment: 'browser-preview',
      selection: {
        status: 'selected',
        publication: {
          id: 'f4cc55dc-c548-4780-b384-0c663bfdb14f',
          displayName: file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
          mimeType: file.type,
          availability: 'selected',
          file,
        },
      },
    });
    render(<App platform={platform} />);

    expect(await screen.findByText('Local EPUB preview')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open EPUB' }));

    expect(await screen.findAllByText('Calm.epub')).toHaveLength(2);
    expect(screen.getByText(/EPUB parsing, table of contents/)).toBeVisible();
    expect(platform.selectPublication).toHaveBeenCalledOnce();
  });

  it('surfaces browser selection errors without replacing the existing shell state', async () => {
    const user = userEvent.setup();
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'Calm.epub', {
      type: 'application/epub+zip',
      lastModified: 1_700_000_000_000,
    });
    const platform = createPlatform({
      environment: 'browser-preview',
      selection: {
        status: 'selected',
        publication: {
          id: 'f4cc55dc-c548-4780-b384-0c663bfdb14f',
          displayName: file.name,
          fileSize: file.size,
          lastModified: file.lastModified,
          mimeType: file.type,
          availability: 'selected',
          file,
        },
      },
    });
    render(<App platform={platform} />);

    expect(await screen.findByText('Local EPUB preview')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open EPUB' }));
    expect(await screen.findByRole('heading', { name: 'Calm.epub' })).toBeVisible();

    vi.mocked(platform.selectPublication).mockRejectedValue(
      new PlatformOperationError('INVALID_ZIP_SIGNATURE', 'Choose a valid EPUB file.'),
    );
    await user.click(screen.getByRole('button', { name: 'Choose another EPUB' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a valid EPUB file.');
    expect(screen.getByRole('heading', { name: 'Calm.epub' })).toBeVisible();
  });

  it('shows a shell-owned crash recovery action', async () => {
    const user = userEvent.setup();
    const platform = createPlatform();
    render(<App platform={platform} />);

    await screen.findByText('Secure reader shell');
    act(() => {
      platform.publishReader({
        status: 'crashed',
        generation: 1,
        canRetry: true,
        message: 'Renderer exited.',
      });
    });

    const restart = screen.getByRole('button', { name: 'Restart reading surface' });
    expect(restart).toBeEnabled();
    await user.click(restart);
    expect(platform.recoverReader).toHaveBeenCalledOnce();
  });
});
