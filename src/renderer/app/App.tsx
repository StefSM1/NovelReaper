import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  platformErrorMessage,
  type NovelReaperPlatform,
  type PublicationDescriptor,
  type SelectedPublication,
} from '../../platform/contracts';
import {
  readerErrorMessage,
  type ReaderEngine,
  type ReaderEngineFactory,
  type ReaderPublication,
  type ReaderRelocation,
  type ReaderTocItem,
} from '../../reader/contracts';
import type { ReaderStateSnapshot } from '../../shared/contracts/ipc';

const INITIAL_READER_STATE: ReaderStateSnapshot = {
  status: 'idle',
  generation: 0,
  canRetry: false,
};

interface AppProps {
  platform: NovelReaperPlatform;
  readerEngineFactory?: ReaderEngineFactory | undefined;
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

type BrowserReaderStatus = 'idle' | 'opening' | 'ready' | 'error';

export function App({ platform, readerEngineFactory }: AppProps): React.JSX.Element {
  const readerFrameRef = useRef<HTMLDivElement>(null);
  const browserReaderHostRef = useRef<HTMLDivElement>(null);
  const browserReaderEngineRef = useRef<ReaderEngine | undefined>(undefined);
  const [readerState, setReaderState] = useState(INITIAL_READER_STATE);
  const [publication, setPublication] = useState<PublicationDescriptor | SelectedPublication>();
  const [parsedPublication, setParsedPublication] = useState<ReaderPublication>();
  const [readerLocation, setReaderLocation] = useState<ReaderRelocation>();
  const [browserReaderStatus, setBrowserReaderStatus] = useState<BrowserReaderStatus>('idle');
  const [readerError, setReaderError] = useState<string>();
  const [isNavigating, setIsNavigating] = useState(false);
  const [readerAttempt, setReaderAttempt] = useState(0);
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
    const unsubscribeExitFocus = platform.onExitFocusRequested(() => {
      setIsFocusMode(false);
    });

    return () => {
      mounted = false;
      unsubscribeReader();
      unsubscribeExitFocus();
    };
  }, [platform]);

  useEffect(() => {
    if (
      publication?.availability !== 'selected' ||
      !('file' in publication) ||
      !readerEngineFactory ||
      !browserReaderHostRef.current
    ) {
      return;
    }

    const source = publication.file;
    const engine = readerEngineFactory();
    const host = browserReaderHostRef.current;
    let active = true;
    browserReaderEngineRef.current?.destroy();
    browserReaderEngineRef.current = engine;
    setParsedPublication(undefined);
    setReaderLocation(undefined);
    setReaderError(undefined);
    setBrowserReaderStatus('opening');

    const unsubscribe = engine.subscribe((event) => {
      if (!active) return;
      if (event.type === 'relocation') setReaderLocation(event.location);
      else setReaderError(event.message);
    });

    void engine
      .open(source, host)
      .then((book) => {
        if (!active) return;
        setParsedPublication(book);
        setBrowserReaderStatus('ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setReaderError(readerErrorMessage(error));
        setBrowserReaderStatus('error');
      });

    return () => {
      active = false;
      unsubscribe();
      engine.destroy();
      if (browserReaderEngineRef.current === engine) browserReaderEngineRef.current = undefined;
    };
  }, [publication, readerAttempt, readerEngineFactory]);

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
        browserReaderEngineRef.current?.destroy();
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

  const openTocItem = async (item: ReaderTocItem): Promise<void> => {
    const engine = browserReaderEngineRef.current;
    if (!engine || isNavigating) return;
    setIsNavigating(true);
    setReaderError(undefined);
    try {
      await engine.goTo(item.target);
    } catch (error) {
      setReaderError(readerErrorMessage(error));
    } finally {
      setIsNavigating(false);
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
        <nav className="titlebar__actions" aria-label="Reader controls">
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
        </nav>
      </header>

      <main className="shell-content">
        <aside className="shell-panel shell-panel--contents" aria-label="Contents preview">
          <p className="eyebrow">Contents</p>
          <h2>{parsedPublication?.metadata.title ?? 'Library preview'}</h2>
          <p className="panel-intro">
            {parsedPublication?.metadata.author
              ? parsedPublication.metadata.author
              : 'Select a local EPUB to read it chapter by chapter in Strict mode.'}
          </p>

          {parsedPublication ? (
            <>
              {parsedPublication.metadata.coverUrl ? (
                <img
                  className="publication-cover"
                  src={parsedPublication.metadata.coverUrl}
                  alt=""
                />
              ) : null}
              <nav className="toc" aria-label="Table of contents" aria-busy={isNavigating}>
                <p className="toc__heading">Chapters</p>
                <ol>
                  {parsedPublication.toc.map((item, itemIndex) => (
                    <li key={item.id}>
                      <button
                        className={
                          readerLocation?.activeTocId === item.id
                            ? 'toc__item toc__item--active'
                            : 'toc__item'
                        }
                        style={
                          {
                            '--toc-indent': `${Math.min(item.depth, 4) * 0.7}rem`,
                          } as React.CSSProperties
                        }
                        type="button"
                        disabled={isNavigating}
                        aria-current={
                          readerLocation?.activeTocId === item.id ? 'location' : undefined
                        }
                        onClick={() => void openTocItem(item)}
                      >
                        <span>{item.label.match(/^(\d+)\s*:/)?.[1] ?? itemIndex + 1}</span>
                        <strong>{item.label}</strong>
                      </button>
                    </li>
                  ))}
                </ol>
              </nav>
            </>
          ) : publication ? (
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
            className="button button--wide contents-open-button"
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
              <dd>Strict · offline</dd>
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
                {publication?.availability === 'selected' && readerEngineFactory ? (
                  <div className="reader-engine-stage">
                    <div className="reader-engine-host" ref={browserReaderHostRef} />
                    {browserReaderStatus === 'opening' ? (
                      <div className="reader-engine-overlay" role="status">
                        <div className="reader-skeleton" aria-label="Opening EPUB">
                          <span />
                          <span />
                          <span />
                        </div>
                        <p>Preparing chapters in Strict mode…</p>
                      </div>
                    ) : null}
                    {browserReaderStatus === 'error' ? (
                      <div
                        className="reader-engine-overlay reader-engine-overlay--error"
                        role="alert"
                      >
                        <p className="chapter-kicker">Could not prepare this book</p>
                        <h1>NovelReaper kept the file untouched.</h1>
                        <p>{readerError}</p>
                        <div className="reader-engine-overlay__actions">
                          <button
                            className="button button--primary"
                            type="button"
                            onClick={() => setReaderAttempt((attempt) => attempt + 1)}
                          >
                            Try again
                          </button>
                          <button type="button" onClick={() => void selectPublication()}>
                            Choose another EPUB
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : isBootstrapping && !publication ? (
                  <div className="reader-skeleton" aria-label="Loading browser preview">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : publication?.availability === 'selected' ? (
                  <div className="publication-ready">
                    <p className="chapter-kicker">File accepted</p>
                    <h1>{publication.displayName}</h1>
                    <div className="ornament" aria-hidden="true">
                      ◆
                    </div>
                    <p>
                      This runtime does not have a chapter engine. Reopen the browser preview to
                      read the selected EPUB.
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
                      Choose a local EPUB to read its metadata, contents, and chapters without
                      uploading or copying the source file.
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
                {readerError && browserReaderStatus === 'ready' ? (
                  <div className="operation-message operation-message--error" role="alert">
                    <strong>Chapter navigation failed</strong>
                    <span>{readerError}</span>
                    <button type="button" onClick={() => setReaderError(undefined)}>
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
            EPUB chapters stay local and open one at a time. Typography controls arrive in a later
            browser phase.
          </p>

          <section className="environment-card" aria-label="Preview environment">
            <span className="environment-card__number">B2</span>
            <div>
              <strong>{isBrowserPreview ? 'Strict EPUB reader' : 'Electron adapter'}</strong>
              <p>
                {isBrowserPreview
                  ? parsedPublication
                    ? `${parsedPublication.spineLength.toLocaleString()} spine sections`
                    : 'Metadata · TOC · chapters'
                  : 'Typed preload IPC'}
              </p>
            </div>
          </section>

          <ol className="phase-steps">
            <li>
              <span>01</span>
              <div>
                <strong>Select locally</strong>
                <p>No upload or managed copy.</p>
              </div>
            </li>
            <li className="phase-steps__active">
              <span>02</span>
              <div>
                <strong>Read locally</strong>
                <p>Metadata, TOC, and one chapter at a time.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>Navigate in B3</strong>
                <p>Progress, restore, and end controls.</p>
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
        <span>Reader engine: {isBrowserPreview ? browserReaderStatus : readerState.status}</span>
      </footer>

      {bootstrapError ? (
        <div className="bootstrap-error" role="alert">
          {bootstrapError}
        </div>
      ) : null}
    </div>
  );
}
