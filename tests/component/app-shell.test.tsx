import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/renderer/app/App';
import type {
  NovelReaperShellApi,
  ReaderStateSnapshot,
  WindowStateSnapshot,
} from '../../src/shared/contracts/ipc';

function installBridge(): {
  api: NovelReaperShellApi;
  publishReader: (state: ReaderStateSnapshot) => void;
  publishWindow: (state: WindowStateSnapshot) => void;
} {
  let readerListener: ((state: ReaderStateSnapshot) => void) | undefined;
  let windowListener: ((state: WindowStateSnapshot) => void) | undefined;

  const api: NovelReaperShellApi = {
    getBootstrapState: vi.fn().mockResolvedValue({
      appName: 'NovelReaper',
      appVersion: '0.1.0',
      reader: { status: 'ready', generation: 1, canRetry: false },
      window: { isMaximized: false, isFullScreen: false },
    }),
    setReaderBounds: vi.fn().mockResolvedValue(undefined),
    recoverReader: vi
      .fn()
      .mockResolvedValue({ status: 'ready', generation: 2, canRetry: false }),
    performWindowAction: vi
      .fn()
      .mockResolvedValue({ isMaximized: false, isFullScreen: true }),
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
  };

  Object.defineProperty(window, 'novelReaperShell', {
    configurable: true,
    value: api,
  });

  return {
    api,
    publishReader: (state) => readerListener?.(state),
    publishWindow: (state) => windowListener?.(state),
  };
}

describe('Phase 1 application shell', () => {
  beforeEach(() => installBridge());

  it('renders the secure shell and its bounded controls', async () => {
    const user = userEvent.setup();
    const { api } = installBridge();
    render(<App />);

    expect(await screen.findByText('Secure reader shell')).toBeVisible();
    expect(screen.getByTestId('reader-frame')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Fullscreen' }));
    expect(api.performWindowAction).toHaveBeenCalledWith('toggle-fullscreen');
    expect(await screen.findByRole('button', { name: 'Exit fullscreen' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Focus mode' }));
    expect(screen.getByRole('button', { name: 'Exit focus · Esc' })).toBeVisible();
  });

  it('shows a shell-owned crash recovery action', async () => {
    const user = userEvent.setup();
    const bridge = installBridge();
    render(<App />);

    await screen.findByText('Secure reader shell');
    act(() => {
      bridge.publishReader({
        status: 'crashed',
        generation: 1,
        canRetry: true,
        message: 'Renderer exited.',
      });
    });

    const restart = screen.getByRole('button', { name: 'Restart reading surface' });
    expect(restart).toBeEnabled();
    await user.click(restart);
    expect(bridge.api.recoverReader).toHaveBeenCalledOnce();
  });
});
