import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  NovelReaperPlatform,
  PlatformCapabilities,
  PublicationSelectionResult,
} from '../../src/platform/contracts';
import { PlatformOperationError } from '../../src/platform/contracts';
import type {
  ReaderEngine,
  ReaderEngineEvent,
  ReaderPublication,
} from '../../src/reader/contracts';
import { App } from '../../src/renderer/app/App';
import type { ReaderStateSnapshot, WindowStateSnapshot } from '../../src/shared/contracts/ipc';

interface FakePlatform extends NovelReaperPlatform {
  publishReader: (state: ReaderStateSnapshot) => void;
  publishWindow: (state: WindowStateSnapshot) => void;
}

const PARSED_BOOK: ReaderPublication = {
  metadata: { title: 'Calm Book', author: 'Quiet Author' },
  toc: [
    { id: 'toc-0', label: 'Opening', target: 'text/opening.xhtml', depth: 0, spineIndex: 0 },
    { id: 'toc-1', label: 'Second Chapter', target: 'text/two.xhtml', depth: 0, spineIndex: 1 },
  ],
  spineLength: 2,
  linearSpineIndices: [0, 1],
};

interface FakeReaderEngine extends ReaderEngine {
  publish: (event: ReaderEngineEvent) => void;
}

function createReaderEngine(options?: { openError?: Error }): FakeReaderEngine {
  let listener: ((event: ReaderEngineEvent) => void) | undefined;
  return {
    applyAppearance: vi.fn().mockResolvedValue(undefined),
    open: vi.fn((_source, container) => {
      if (options?.openError) return Promise.reject(options.openError);
      const surface = document.createElement('div');
      surface.textContent = 'Rendered chapter';
      container.replaceChildren(surface);
      listener?.({
        type: 'relocation',
        location: {
          spineIndex: 0,
          href: 'text/opening.xhtml',
          fractionInChapter: 0,
          activeTocId: 'toc-0',
        },
      });
      return Promise.resolve(PARSED_BOOK);
    }),
    goTo: vi.fn((target) => {
      if (target === 'text/two.xhtml' || target === 1) {
        listener?.({
          type: 'relocation',
          location: {
            spineIndex: 1,
            href: 'text/two.xhtml',
            fractionInChapter: 0,
            activeTocId: 'toc-1',
          },
        });
      }
      return Promise.resolve();
    }),
    setNavigationState: vi.fn(),
    subscribe: vi.fn((nextListener) => {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    }),
    destroy: vi.fn(),
    publish: (event) => listener?.(event),
  };
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
      library: [],
      notices: [],
    }),
    selectPublication: vi.fn().mockResolvedValue(
      options?.selection ?? {
        status: 'unsupported',
        reason: 'Not available in this test adapter.',
      },
    ),
    updateLibraryPublication: vi.fn().mockResolvedValue([]),
    removeLibraryPublication: vi.fn().mockResolvedValue([]),
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
  beforeEach(() => window.localStorage.clear());

  it('starts the Electron shell on its bounded library screen', async () => {
    const platform = createPlatform();
    render(<App platform={platform} />);

    expect(await screen.findByText('NovelReaper')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'No volumes yet' })).toBeVisible();
    expect(screen.queryByTestId('reader-frame')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fullscreen/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open EPUB' })).toBeDisabled();
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
    const engine = createReaderEngine();
    render(<App platform={platform} readerEngineFactory={() => engine} />);

    expect(await screen.findByRole('button', { name: 'Open EPUB' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open EPUB' }));

    expect(await screen.findByRole('heading', { name: 'Calm Book' })).toBeVisible();
    expect(screen.getByText('Quiet Author')).toBeVisible();
    expect(screen.getByRole('button', { name: /Opening/ })).toHaveAttribute(
      'aria-current',
      'location',
    );
    await user.click(screen.getByRole('button', { name: /Second Chapter/ }));
    expect(engine.goTo).toHaveBeenCalledWith('text/two.xhtml');
    expect(screen.getByRole('button', { name: /Second Chapter/ })).toHaveAttribute(
      'aria-current',
      'location',
    );
    expect(screen.getByRole('progressbar', { name: 'Overall reading progress' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    expect(platform.selectPublication).toHaveBeenCalledOnce();
  });

  it('completes only through Next and Finish navigation requests', async () => {
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
    const engine = createReaderEngine();
    render(<App platform={platform} readerEngineFactory={() => engine} />);

    await user.click(await screen.findByRole('button', { name: 'Open EPUB' }));
    expect(await screen.findByRole('heading', { name: 'Calm Book' })).toBeVisible();
    act(() => engine.publish({ type: 'navigation-request', request: { source: 'next' } }));

    expect(engine.goTo).toHaveBeenCalledWith(1);
    expect(
      await screen.findByRole('progressbar', { name: 'Overall reading progress' }),
    ).toHaveAttribute('aria-valuenow', '50');
    act(() => engine.publish({ type: 'navigation-request', request: { source: 'finish' } }));
    expect(
      await screen.findByRole('progressbar', { name: 'Overall reading progress' }),
    ).toHaveAttribute('aria-valuenow', '100');
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
    const engine = createReaderEngine();
    render(<App platform={platform} readerEngineFactory={() => engine} />);

    expect(await screen.findByRole('button', { name: 'Open EPUB' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open EPUB' }));
    expect(await screen.findByRole('heading', { name: 'Calm Book' })).toBeVisible();

    vi.mocked(platform.selectPublication).mockRejectedValue(
      new PlatformOperationError('INVALID_ZIP_SIGNATURE', 'Choose a valid EPUB file.'),
    );
    await user.click(screen.getByRole('button', { name: 'Choose another EPUB' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a valid EPUB file.');
    expect(screen.getByRole('heading', { name: 'Calm Book' })).toBeVisible();
  });

  it('shows selection errors on the Library screen', async () => {
    const user = userEvent.setup();
    const platform = createPlatform({ environment: 'browser-preview' });
    vi.mocked(platform.selectPublication).mockRejectedValue(
      new PlatformOperationError('INVALID_ZIP_SIGNATURE', 'Choose a valid EPUB file.'),
    );
    render(<App platform={platform} readerEngineFactory={() => createReaderEngine()} />);

    await user.click(await screen.findByRole('button', { name: 'Open EPUB' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a valid EPUB file.');
    expect(screen.getByRole('heading', { name: 'No volumes yet' })).toBeVisible();
  });

  it('shows a recoverable EPUB engine error with retry and reselect actions', async () => {
    const user = userEvent.setup();
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'Broken.epub', {
      type: 'application/epub+zip',
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
    const engine = createReaderEngine({ openError: new Error('broken') });
    render(<App platform={platform} readerEngineFactory={() => engine} />);

    await user.click(await screen.findByRole('button', { name: 'Open EPUB' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('file untouched');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    expect(screen.getAllByRole('button', { name: 'Choose another EPUB' })).toHaveLength(2);
  });

  it('applies and persists reader appearance and focus mode', async () => {
    const user = userEvent.setup();
    const file = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'Calm.epub', {
      type: 'application/epub+zip',
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
    const engine = createReaderEngine();
    render(<App platform={platform} readerEngineFactory={() => engine} />);

    await user.click(await screen.findByRole('button', { name: 'Open EPUB' }));
    await screen.findByRole('heading', { name: 'Calm Book' });
    await user.click(screen.getByRole('button', { name: 'Dark' }));

    expect(engine.applyAppearance).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'dark' }),
    );
    expect(document.querySelector('.app')).toHaveClass('app--dark');

    await user.click(screen.getByRole('switch', { name: 'Toggle focus mode' }));
    expect(document.querySelector('.app')).toHaveClass('app--focus');
    expect(window.localStorage.getItem('novelreaper:browser-settings:v1')).toContain('"focus"');
  });

  it('keeps the library usable when the dormant Electron reader reports a crash', async () => {
    const platform = createPlatform();
    render(<App platform={platform} />);

    await screen.findByText('NovelReaper');
    act(() => {
      platform.publishReader({
        status: 'crashed',
        generation: 1,
        canRetry: true,
        message: 'Renderer exited.',
      });
    });

    expect(screen.getByRole('heading', { name: 'No volumes yet' })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Restart reading surface' }),
    ).not.toBeInTheDocument();
  });
});
