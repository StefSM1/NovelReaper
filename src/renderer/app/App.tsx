import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  platformErrorMessage,
  type NovelReaperPlatform,
  type PublicationDescriptor,
} from '../../platform/contracts';
import type { ReaderStateSnapshot, WindowStateSnapshot } from '../../shared/contracts/ipc';

const INITIAL_READER_STATE: ReaderStateSnapshot = {
  status: 'idle',
  generation: 0,
  canRetry: false,
};

const INITIAL_WINDOW_STATE: WindowStateSnapshot = {
  isMaximized: false,
  isFullScreen: false,
};

interface AppProps {
  platform: NovelReaperPlatform;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatDate(timestamp: number): string {
  if (timestamp === 0) return 'Unknown date';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(timestamp);
}

export function App({ platform }: AppProps): React.JSX.Element {
  const readerFrameRef = useRef<HTMLDivElement>(null);
  const [readerState, setReaderState] = useState(INITIAL_READER_STATE);
  const [windowState, setWindowState] = useState(INITIAL_WINDOW_STATE);
  const [publication, setPublication] = useState<PublicationDescriptor>();
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSelecting, setIsSelecting] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string>();
  const [operationError, setOperationError] = useState<string>();
  const [notices, setNotices] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;
    void platform
      .getBootstrapState()
      .then((state) => {
        if (!mounted) return;
        setReaderState(state.reader);
        setWindowState(state.window);
        setPublication(state.recentPublication);
        setNotices(state.notices);
        setIsBootstrapping(false);
      })
      .catch(() => {
        if (!mounted) return;
        setBootstrapError('The NovelReaper platform adapter did not initialize.');
        setIsBootstrapping(false);
      });

    const unsubscribeReader = platform.onReaderState(setReaderState);
    const unsubscribeWindow = platform.onWindowState(setWindowState);
    const unsubscribeExitFocus = platform.onExitFocusRequested(() => {
      setIsFocusMode(false);
    });

    return () => {
      mounted = false;
      unsubscribeReader();
      unsubscribeWindow();
      unsubscribeExitFocus();
    };
  }, [platform]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsFocusMode(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  const reportReaderBounds = useCallback(() => {
    if (platform.environment !== 'electron') return;
    const frame = readerFrameRef.current;
    if (!frame) return;

    const rect = frame.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    void platform
      .setReaderBounds({
        x: Math.max(0, Math.round(rect.x)),
        y: Math.max(0, Math.round(rect.y)),
        width: Math.max(1, Math.round(rect.width)),
        height: Math.max(1, Math.round(rect.height)),
      })
      .catch(() => setOperationError('The reading surface could not be resized.'));
  }, [platform]);

  useLayoutEffect(() => {
    reportReaderBounds();
    const frame = readerFrameRef.current;
    if (!frame || platform.environment !== 'electron') return;

    const observer = new ResizeObserver(reportReaderBounds);
    observer.observe(frame);
    window.addEventListener('resize', reportReaderBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', reportReaderBounds);
    };
  }, [isFocusMode, platform.environment, reportReaderBounds]);

  const selectPublication = async (): Promise<void> => {
    if (isSelecting) return;
    setIsSelecting(true);
    setOperationError(undefined);

    try {
      const result = await platform.selectPublication();
      if (result.status === 'selected') {
        setPublication(result.publication);
        const warning = result.warning;
        if (warning) {
          setNotices((current) => [...current, warning]);
        }
      }
      if (result.status === 'unsupported') setOperationError(result.reason);
    } catch (error) {
      setOperationError(platformErrorMessage(error));
    } finally {
      setIsSelecting(false);
    }
  };

  const recoverReader = (): void => {
    setReaderState((state) => ({ ...state, status: 'creating', canRetry: false }));
    void platform
      .recoverReader()
      .then(setReaderState)
      .catch(() => {
        setReaderState((state) => ({
          ...state,
          status: 'crashed',
          canRetry: true,
          message: 'Reader recovery failed.',
        }));
      });
  };

  const toggleFullscreen = (): void => {
    setOperationError(undefined);
    void platform
      .toggleFullscreen()
      .then(setWindowState)
      .catch((error: unknown) => setOperationError(platformErrorMessage(error)));
  };

  const isBrowserPreview = platform.environment === 'browser-preview';
  const publicationStatus = publication?.availability ?? 'none';

  return (
    <div className={isFocusMode ? 'app app--focus' : 'app'}>
      <header className="titlebar" data-testid="titlebar">
        <div className="titlebar__brand">
          <span aria-hidden="true" className="brand-mark">
            NR
          </span>
          <span>NovelReaper</span>
        </div>
        {isBrowserPreview ? <span className="preview-ribbon">Browser preview</span> : null}
      </header>

      <nav className="phase-toolbar" aria-label="Reader shell controls">
        <div>
          <p className="eyebrow">{isBrowserPreview ? 'Browser Phase B1' : 'Desktop foundation'}</p>
          <strong>{isBrowserPreview ? 'Local EPUB preview' : 'Secure reader shell'}</strong>
        </div>
        <div className="phase-toolbar__actions">
          <button
            className="button button--primary"
            type="button"
            disabled={!platform.capabilities.selectLocalPublication || isSelecting}
            onClick={() => void selectPublication()}
          >
            {isSelecting ? 'Opening…' : 'Open EPUB'}
          </button>
          <button type="button" onClick={() => setIsFocusMode((value) => !value)}>
            {isFocusMode ? 'Exit focus' : 'Focus mode'}
          </button>
          <button
            type="button"
            disabled={!platform.capabilities.fullscreen}
            onClick={toggleFullscreen}
          >
            {windowState.isFullScreen ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        </div>
      </nav>

      <main className="shell-content">
        <aside className="shell-panel shell-panel--contents" aria-label="Contents preview">
          <p className="eyebrow">Contents</p>
          <h2>Library preview</h2>
          <p className="panel-intro">
            Select an EPUB from this computer. Browser Phase B1 validates it locally and remembers
            metadata—not the source path.
          </p>

          {publication ? (
            <article className="publication-card" aria-label="Selected publication">
              <span className="publication-card__index" aria-hidden="true">
                01
              </span>
              <div>
                <strong>{publication.displayName}</strong>
                <small>{formatFileSize(publication.fileSize)}</small>
              </div>
            </article>
          ) : (
            <div className="contents-empty">
              <span aria-hidden="true">—</span>
              <p>No publication selected</p>
            </div>
          )}

          <button
            className="button button--wide"
            type="button"
            disabled={!platform.capabilities.selectLocalPublication || isSelecting}
            onClick={() => void selectPublication()}
          >
            {publication ? 'Choose another EPUB' : 'Choose an EPUB'}
          </button>

          <dl className="capability-list">
            <div>
              <dt>Upload</dt>
              <dd>None</dd>
            </div>
            <div>
              <dt>File access</dt>
              <dd>This tab only</dd>
            </div>
            <div>
              <dt>Safety</dt>
              <dd>Strict</dd>
            </div>
          </dl>
        </aside>

        <section className="reader-column" aria-label="Reading surface">
          <div
            className={isBrowserPreview ? 'reader-frame reader-frame--browser' : 'reader-frame'}
            ref={readerFrameRef}
            data-testid="reader-frame"
          >
            {readerState.status === 'crashed' ? (
              <div className="reader-fallback" role="alert">
                <p className="eyebrow">Reader isolated</p>
                <h2>The reading surface stopped responding.</h2>
                <p>{readerState.message ?? 'The application shell is still safe and usable.'}</p>
                <button type="button" disabled={!readerState.canRetry} onClick={recoverReader}>
                  Restart reading surface
                </button>
              </div>
            ) : isBrowserPreview ? (
              <div className="browser-reading-sheet">
                {isBootstrapping && !publication ? (
                  <div className="reader-skeleton" aria-label="Loading browser preview">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : publication?.availability === 'selected' ? (
                  <div className="publication-ready">
                    <p className="chapter-kicker">File accepted · Strict preview</p>
                    <h1>{publication.displayName}</h1>
                    <div className="ornament" aria-hidden="true">
                      ◆
                    </div>
                    <p>
                      NovelReaper has validated the file extension, size, and ZIP signature. The
                      file remains in this browser tab and has not been uploaded or copied.
                    </p>
                    <dl className="file-facts">
                      <div>
                        <dt>Size</dt>
                        <dd>{formatFileSize(publication.fileSize)}</dd>
                      </div>
                      <div>
                        <dt>Modified</dt>
                        <dd>{formatDate(publication.lastModified)}</dd>
                      </div>
                    </dl>
                    <aside className="next-phase-note">
                      <span>B2</span>
                      <p>
                        EPUB parsing, table of contents, and chapter rendering are the next
                        implementation stop.
                      </p>
                    </aside>
                  </div>
                ) : publication?.availability === 'reselect-required' ? (
                  <div className="publication-ready publication-ready--reselect">
                    <p className="chapter-kicker">Browser source unavailable after refresh</p>
                    <h1>Select this book again</h1>
                    <p>
                      NovelReaper remembered the preview metadata for{' '}
                      <strong>{publication.displayName}</strong>, but browsers do not preserve
                      unrestricted access to the original file.
                    </p>
                    <button
                      className="button button--primary"
                      type="button"
                      disabled={isSelecting}
                      onClick={() => void selectPublication()}
                    >
                      Select again
                    </button>
                  </div>
                ) : (
                  <div className="publication-ready publication-ready--empty">
                    <p className="chapter-kicker">A quiet place for long-form reading</p>
                    <h1>Your next chapter starts here.</h1>
                    <div className="ornament" aria-hidden="true">
                      ◆
                    </div>
                    <p>
                      Choose a local EPUB to establish the browser reader session. Actual chapter
                      rendering begins in Browser Phase B2.
                    </p>
                    <button
                      className="button button--primary"
                      type="button"
                      disabled={isSelecting}
                      onClick={() => void selectPublication()}
                    >
                      Open an EPUB
                    </button>
                  </div>
                )}

                {operationError ? (
                  <div className="operation-message operation-message--error" role="alert">
                    <strong>Could not open that publication</strong>
                    <span>{operationError}</span>
                    <button type="button" onClick={() => setOperationError(undefined)}>
                      Dismiss
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <span className="visually-hidden" aria-live="polite">
                Reader status: {readerState.status}
              </span>
            )}
          </div>
        </section>

        <aside className="shell-panel shell-panel--appearance" aria-label="Appearance preview">
          <p className="eyebrow">Appearance</p>
          <h2>Warm editorial</h2>
          <p className="panel-intro">
            The shared shell is running independently of Electron. Reading controls arrive after the
            EPUB engine is connected.
          </p>

          <section className="environment-card" aria-label="Preview environment">
            <span className="environment-card__number">B1</span>
            <div>
              <strong>{isBrowserPreview ? 'Browser adapter' : 'Electron adapter'}</strong>
              <p>{isBrowserPreview ? 'File + Blob APIs' : 'Typed preload IPC'}</p>
            </div>
          </section>

          <ol className="phase-steps">
            <li className="phase-steps__active">
              <span>01</span>
              <div>
                <strong>Select locally</strong>
                <p>No upload or managed copy.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>Read in B2</strong>
                <p>Metadata, TOC, and chapters.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Polish together</strong>
                <p>Shared UI before Electron.</p>
              </div>
            </li>
          </ol>

          {notices.map((notice) => (
            <div className="operation-message" role="status" key={notice}>
              {notice}
            </div>
          ))}
        </aside>
      </main>

      <footer className="statusbar">
        <span>Environment: {isBrowserPreview ? 'Browser' : 'Electron'}</span>
        <span>Source: {publicationStatus}</span>
        <span>Reader engine: {isBrowserPreview ? 'B2 pending' : readerState.status}</span>
        <span>{windowState.isFullScreen ? 'Fullscreen' : 'Windowed'}</span>
      </footer>

      {isFocusMode ? (
        <button className="focus-exit" type="button" onClick={() => setIsFocusMode(false)}>
          Exit focus · Esc
        </button>
      ) : null}

      {bootstrapError ? (
        <div className="bootstrap-error" role="alert">
          {bootstrapError}
        </div>
      ) : null}
    </div>
  );
}
