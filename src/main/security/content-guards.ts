import type { WebContents } from 'electron';

export type GuardFailure = {
  code: 'load-failed' | 'preload-failed' | 'renderer-gone' | 'unresponsive';
  message: string;
};

export function attachContentGuards(options: {
  contents: WebContents;
  isNavigationAllowed: (url: string) => boolean;
  onKeyboardEscape: () => void;
  onKeyboardFullscreen: () => void;
  onFailure?: (failure: GuardFailure) => void;
  preventTitleUpdates?: boolean;
}): () => void {
  const {
    contents,
    isNavigationAllowed,
    onKeyboardEscape,
    onKeyboardFullscreen,
    onFailure,
    preventTitleUpdates = true,
  } = options;

  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const onFrameNavigate = (details: Electron.Event<Electron.WebContentsWillFrameNavigateEventParams>): void => {
    if (!isNavigationAllowed(details.url)) details.preventDefault();
  };
  const onNavigate = (details: Electron.Event<Electron.WebContentsWillNavigateEventParams>): void => {
    if (!isNavigationAllowed(details.url)) details.preventDefault();
  };
  const onRedirect = (details: Electron.Event<Electron.WebContentsWillRedirectEventParams>): void => {
    if (!isNavigationAllowed(details.url)) details.preventDefault();
  };
  const onBoundsUpdated = (event: Electron.Event): void => event.preventDefault();
  const onAttachWebview = (event: Electron.Event): void => event.preventDefault();
  const onPageTitleUpdated = (event: Electron.Event): void => {
    if (preventTitleUpdates) event.preventDefault();
  };
  const onBluetooth = (
    event: Electron.Event,
    _devices: Electron.BluetoothDevice[],
    callback: (deviceId: string) => void,
  ): void => {
    event.preventDefault();
    callback('');
  };
  const onBeforeInput = (event: Electron.Event, input: Electron.Input): void => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if (input.key === 'F11') {
      event.preventDefault();
      onKeyboardFullscreen();
    }
    if (input.key === 'Escape') {
      event.preventDefault();
      onKeyboardEscape();
    }
  };
  const onPreloadError = (_event: Electron.Event, preloadPath: string, error: Error): void => {
    onFailure?.({
      code: 'preload-failed',
      message: `Reader preload failed (${preloadPath}): ${error.message}`,
    });
  };
  const onDidFailLoad = (
    _event: Electron.Event,
    errorCode: number,
    errorDescription: string,
    _validatedUrl: string,
    isMainFrame: boolean,
  ): void => {
    if (isMainFrame && errorCode !== -3) {
      onFailure?.({ code: 'load-failed', message: errorDescription });
    }
  };
  const onRendererGone = (
    _event: Electron.Event,
    details: Electron.RenderProcessGoneDetails,
  ): void => {
    onFailure?.({
      code: 'renderer-gone',
      message: `Reading surface exited: ${details.reason}.`,
    });
  };
  const onUnresponsive = (): void => {
    onFailure?.({ code: 'unresponsive', message: 'Reading surface became unresponsive.' });
  };

  contents.on('will-frame-navigate', onFrameNavigate);
  contents.on('will-navigate', onNavigate);
  contents.on('will-redirect', onRedirect);
  contents.on('content-bounds-updated', onBoundsUpdated);
  contents.on('will-attach-webview', onAttachWebview);
  contents.on('page-title-updated', onPageTitleUpdated);
  contents.on('select-bluetooth-device', onBluetooth);
  contents.on('before-input-event', onBeforeInput);
  contents.on('preload-error', onPreloadError);
  contents.on('did-fail-load', onDidFailLoad);
  contents.on('render-process-gone', onRendererGone);
  contents.on('unresponsive', onUnresponsive);

  return () => {
    if (contents.isDestroyed()) return;
    contents.removeListener('will-frame-navigate', onFrameNavigate);
    contents.removeListener('will-navigate', onNavigate);
    contents.removeListener('will-redirect', onRedirect);
    contents.removeListener('content-bounds-updated', onBoundsUpdated);
    contents.removeListener('will-attach-webview', onAttachWebview);
    contents.removeListener('page-title-updated', onPageTitleUpdated);
    contents.removeListener('select-bluetooth-device', onBluetooth);
    contents.removeListener('before-input-event', onBeforeInput);
    contents.removeListener('preload-error', onPreloadError);
    contents.removeListener('did-fail-load', onDidFailLoad);
    contents.removeListener('render-process-gone', onRendererGone);
    contents.removeListener('unresponsive', onUnresponsive);
  };
}
