import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  platformErrorMessage,
  type NovelReaperPlatform,
  type PublicationDescriptor,
  type SelectedPublication,
} from '../../platform/contracts';
import {
  browserProgressStorageKey,
  BrowserProgressStore,
  DebouncedProgressWriter,
} from '../../platform/browser/browser-progress-store';
import {
  loadBrowserReaderPreferences,
  saveBrowserReaderPreferences,
  type BrowserReaderPreferences,
} from '../../platform/browser/browser-settings-store';
import {
  readerErrorMessage,
  type ReaderEngine,
  type ReaderEngineFactory,
  type ReaderPublication,
  type ReaderRelocation,
  type ReaderTocItem,
} from '../../reader/contracts';
import { navigationErrorMessage, ReaderNavigationService } from '../../reader/navigation-service';
import {
  createReaderProgress,
  overallProgress,
  storedReaderProgress,
  type ReaderProgressState,
} from '../../reader/progress-state';
import type { ReaderStateSnapshot, WindowStateSnapshot } from '../../shared/contracts/ipc';
import { AppearancePanel } from './AppearancePanel';
import { LibraryScreen } from './LibraryScreen';
import { VirtualizedToc } from './VirtualizedToc';

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

function descriptorFromSelection(publication: SelectedPublication): PublicationDescriptor {
  return {
    id: publication.id,
    displayName: publication.displayName,
    fileSize: publication.fileSize,
    lastModified: publication.lastModified,
    mimeType: publication.mimeType,
    availability: publication.availability,
    ...(publication.title ? { title: publication.title } : {}),
    ...(publication.author ? { author: publication.author } : {}),
    ...(publication.spineLength ? { spineLength: publication.spineLength } : {}),
    ...(publication.lastOpenedAt ? { lastOpenedAt: publication.lastOpenedAt } : {}),
  };
}

function upsertLibraryEntry(
  entries: PublicationDescriptor[],
  entry: PublicationDescriptor,
): PublicationDescriptor[] {
  return [entry, ...entries.filter((current) => current.id !== entry.id)].sort(
    (left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0),
  );
}

type BrowserReaderStatus = 'idle' | 'opening' | 'ready' | 'error';
type AppScreen = 'library' | 'reader';
type MobileReaderView = 'appearance' | 'contents' | 'reader';

export function App({ platform, readerEngineFactory }: AppProps): React.JSX.Element {
  const readerFrameRef = useRef<HTMLDivElement>(null);
  const browserReaderHostRef = useRef<HTMLDivElement>(null);
  const browserReaderEngineRef = useRef<ReaderEngine | undefined>(undefined);
  const navigationServiceRef = useRef<ReaderNavigationService | undefined>(undefined);
  const sessionPublicationsRef = useRef(new Map<string, SelectedPublication>());
  const [settingsLoad] = useState(loadBrowserReaderPreferences);
  const preferencesRef = useRef(settingsLoad.preferences);
  const [preferences, setPreferences] = useState(settingsLoad.preferences);
  const [readerState, setReaderState] = useState(INITIAL_READER_STATE);
  const [windowState, setWindowState] = useState<WindowStateSnapshot>({
    isMaximized: false,
    isFullScreen: false,
  });
  const [screen, setScreen] = useState<AppScreen>('library');
  const [mobileReaderView, setMobileReaderView] = useState<MobileReaderView>('reader');
  const [library, setLibrary] = useState<PublicationDescriptor[]>([]);
  const [publication, setPublication] = useState<PublicationDescriptor | SelectedPublication>();
  const [parsedPublication, setParsedPublication] = useState<ReaderPublication>();
  const [readerLocation, setReaderLocation] = useState<ReaderRelocation>();
  const [readerProgress, setReaderProgress] = useState<ReaderProgressState>();
  const [browserReaderStatus, setBrowserReaderStatus] = useState<BrowserReaderStatus>('idle');
  const [readerError, setReaderError] = useState<string>();
  const [isNavigating, setIsNavigating] = useState(false);
  const [readerAttempt, setReaderAttempt] = useState(0);
  const [isApplyingAppearance, setIsApplyingAppearance] = useState(false);
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
        setLibrary(state.library);
        setNotices(settingsLoad.warning ? [...state.notices, settingsLoad.warning] : state.notices);
        setIsBootstrapping(false);
      })
      .catch(() => {
        if (!mounted) return;
        setBootstrapError('The NovelReaper platform adapter did not initialize.');
        setIsBootstrapping(false);
      });

    const unsubscribeReader = platform.onReaderState(setReaderState);
    const unsubscribeExitFocus = platform.onExitFocusRequested(() => {
      setPreferences((current) => ({ ...current, mode: 'dashboard' }));
    });
    const unsubscribeWindow = platform.onWindowState(setWindowState);

    return () => {
      mounted = false;
      unsubscribeReader();
      unsubscribeExitFocus();
      unsubscribeWindow();
    };
  }, [platform, settingsLoad.warning]);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

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
    let storage: Storage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      storage = undefined;
    }
    const progressStore = new BrowserProgressStore(storage, browserProgressStorageKey(publication));
    const savedProgress = progressStore.load();
    const progressLoadWarning = progressStore.takeLoadWarning();
    const initialLocator = savedProgress?.positions[String(savedProgress.currentSpineIndex)];
    let saveWarningShown = false;
    const progressWriter = new DebouncedProgressWriter(progressStore, () => {
      if (saveWarningShown) return;
      saveWarningShown = true;
      setNotices((current) => [
        ...current,
        'Reading progress could not be saved in this browser session.',
      ]);
    });
    let active = true;
    let pendingLocation: ReaderRelocation | undefined;
    browserReaderEngineRef.current?.destroy();
    browserReaderEngineRef.current = engine;
    navigationServiceRef.current = undefined;
    setParsedPublication(undefined);
    setReaderLocation(undefined);
    setReaderProgress(undefined);
    setReaderError(undefined);
    setBrowserReaderStatus('opening');

    const unsubscribe = engine.subscribe((event) => {
      if (!active) return;
      if (event.type === 'relocation') {
        pendingLocation = event.location;
        setReaderLocation(event.location);
        navigationServiceRef.current?.relocate(event.location);
      } else if (event.type === 'navigation-request') {
        void navigationServiceRef.current?.navigate(event.request).catch((error: unknown) => {
          setReaderError(navigationErrorMessage(error));
        });
      } else setReaderError(event.message);
    });

    const flushProgress = (): void => navigationServiceRef.current?.flush();
    const flushWhenHidden = (): void => {
      if (document.visibilityState === 'hidden') flushProgress();
    };
    window.addEventListener('pagehide', flushProgress);
    document.addEventListener('visibilitychange', flushWhenHidden);

    void engine
      .applyAppearance(preferencesRef.current.appearance)
      .then(() => engine.open(source, host, initialLocator))
      .then((book) => {
        if (!active) return;
        if (progressLoadWarning) {
          setNotices((current) =>
            current.includes(progressLoadWarning) ? current : [...current, progressLoadWarning],
          );
        }
        const initialProgress = createReaderProgress(
          book.linearSpineIndices,
          savedProgress,
          pendingLocation,
        );
        const navigationService = new ReaderNavigationService({
          engine,
          initialState: initialProgress,
          onState: (progress, location) => {
            if (!active) return;
            setReaderProgress(progress);
            if (location) setReaderLocation(location);
            progressWriter.schedule(storedReaderProgress(progress));
          },
          onBusy: (busy) => {
            if (active) setIsNavigating(busy);
          },
          flush: (progress) => progressWriter.flush(progress),
        });
        navigationServiceRef.current = navigationService;
        setReaderProgress(initialProgress);
        setParsedPublication(book);
        setBrowserReaderStatus('ready');
        const update = {
          title: book.metadata.title,
          ...(book.metadata.author ? { author: book.metadata.author } : {}),
          spineLength: book.spineLength,
          lastOpenedAt: Date.now(),
        };
        void platform
          .updateLibraryPublication(publication.id, update)
          .then((entries) => {
            if (!active) return;
            const selected = sessionPublicationsRef.current.get(publication.id);
            const fallback = selected
              ? { ...descriptorFromSelection(selected), ...update }
              : { ...descriptorFromSelection(publication), ...update };
            if (entries.length) setLibrary(entries);
            else setLibrary((current) => upsertLibraryEntry(current, fallback));
          })
          .catch(() => {
            if (!active) return;
            setNotices((current) => [...current, 'Library metadata could not be saved.']);
          });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setReaderError(readerErrorMessage(error));
        setBrowserReaderStatus('error');
      });

    return () => {
      active = false;
      window.removeEventListener('pagehide', flushProgress);
      document.removeEventListener('visibilitychange', flushWhenHidden);
      navigationServiceRef.current?.flush();
      progressWriter.dispose();
      unsubscribe();
      engine.destroy();
      if (browserReaderEngineRef.current === engine) browserReaderEngineRef.current = undefined;
      navigationServiceRef.current = undefined;
    };
  }, [platform, publication, readerAttempt, readerEngineFactory]);

  const commitPreferences = useCallback(
    (next: BrowserReaderPreferences): void => {
      preferencesRef.current = next;
      setPreferences(next);
      if (platform.environment === 'browser-preview' && !saveBrowserReaderPreferences(next)) {
        const warning = 'Reader settings could not be saved in this browser session.';
        setNotices((current) => (current.includes(warning) ? current : [...current, warning]));
      }
    },
    [platform.environment],
  );

  const changeMode = useCallback(
    (mode: BrowserReaderPreferences['mode']): void => {
      setMobileReaderView('reader');
      commitPreferences({ ...preferencesRef.current, mode });
    },
    [commitPreferences],
  );

  const changeAppearance = (update: Partial<BrowserReaderPreferences['appearance']>): void => {
    if (isApplyingAppearance) return;
    const appearance = { ...preferencesRef.current.appearance, ...update };
    commitPreferences({ ...preferencesRef.current, appearance });
    const engine = browserReaderEngineRef.current;
    if (!engine) return;
    setIsApplyingAppearance(true);
    setReaderError(undefined);
    void engine
      .applyAppearance(appearance)
      .catch(() => setReaderError('That appearance change could not be applied.'))
      .finally(() => setIsApplyingAppearance(false));
  };

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      if (mobileReaderView !== 'reader') setMobileReaderView('reader');
      else changeMode('dashboard');
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [changeMode, mobileReaderView]);

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
  }, [platform.environment, preferences.mode, reportReaderBounds]);

  const selectPublication = async (): Promise<void> => {
    if (isSelecting) return;
    setIsSelecting(true);
    setOperationError(undefined);

    try {
      const result = await platform.selectPublication();
      if (result.status === 'selected') {
        browserReaderEngineRef.current?.destroy();
        sessionPublicationsRef.current.set(result.publication.id, result.publication);
        setLibrary((current) =>
          upsertLibraryEntry(current, descriptorFromSelection(result.publication)),
        );
        setPublication(result.publication);
        setMobileReaderView('reader');
        setScreen('reader');
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

  const openLibraryEntry = (entry: PublicationDescriptor): void => {
    const selected = sessionPublicationsRef.current.get(entry.id);
    if (!selected) {
      void selectPublication();
      return;
    }
    setPublication(selected);
    setMobileReaderView('reader');
    setScreen('reader');
  };

  const removeLibraryEntry = async (entry: PublicationDescriptor): Promise<boolean> => {
    setOperationError(undefined);
    try {
      const entries = await platform.removeLibraryPublication(entry.id);
      sessionPublicationsRef.current.delete(entry.id);
      setLibrary(
        entries.length ? entries : (current) => current.filter((item) => item.id !== entry.id),
      );
      if (publication?.id === entry.id) {
        browserReaderEngineRef.current?.destroy();
        setPublication(undefined);
        setParsedPublication(undefined);
        setReaderProgress(undefined);
        setReaderLocation(undefined);
        setScreen('library');
      }
      return true;
    } catch {
      setOperationError('That library card could not be removed.');
      return false;
    }
  };

  const toggleFullscreen = (): void => {
    setOperationError(undefined);
    void platform
      .toggleFullscreen()
      .then(setWindowState)
      .catch((error: unknown) => {
        setOperationError(platformErrorMessage(error));
      });
  };

  const openTocItem = async (item: ReaderTocItem): Promise<void> => {
    const navigation = navigationServiceRef.current;
    if (!navigation || isNavigating) return;
    setReaderError(undefined);
    try {
      await navigation.navigate({
        source: 'contents',
        target: item.target,
      });
      setMobileReaderView('reader');
    } catch (error) {
      setReaderError(navigationErrorMessage(error));
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
  const overallPercent = readerProgress ? Math.round(overallProgress(readerProgress) * 100) : 0;
  const chapterPercent = readerLocation ? Math.round(readerLocation.fractionInChapter * 100) : 0;
  const isFocusMode = screen === 'reader' && preferences.mode === 'focus';
  const appClassName = [
    'app',
    isFocusMode ? 'app--focus' : '',
    screen === 'library' ? 'app--library' : '',
    screen === 'reader' ? `app--mobile-${mobileReaderView}` : '',
    preferences.appearance.theme === 'dark' ? 'app--dark' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={appClassName} data-theme={preferences.appearance.theme}>
      <header className="titlebar" data-testid="titlebar">
        <div className="titlebar__brand">
          <span aria-hidden="true" className="brand-mark">
            NR
          </span>
          <span>NovelReaper</span>
        </div>
        <nav className="titlebar__actions" aria-label="Reader controls">
          {screen === 'reader' ? (
            <button
              className="titlebar__library"
              type="button"
              onClick={() => {
                setMobileReaderView('reader');
                setScreen('library');
              }}
            >
              Library
            </button>
          ) : null}
          <button
            className="button button--primary titlebar__open"
            type="button"
            disabled={!platform.capabilities.selectLocalPublication || isSelecting}
            onClick={() => void selectPublication()}
          >
            {isSelecting ? 'Opening…' : 'Open EPUB'}
          </button>
          {screen === 'reader' && publication ? (
            <button
              className="titlebar__focus"
              type="button"
              onClick={() => changeMode(isFocusMode ? 'dashboard' : 'focus')}
            >
              {isFocusMode ? 'Exit focus' : 'Focus mode'}
            </button>
          ) : null}
        </nav>
      </header>

      {screen === 'library' ? (
        <LibraryScreen
          entries={library}
          isLoading={isBootstrapping}
          isSelecting={isSelecting}
          error={operationError}
          hasSessionFile={(id) => sessionPublicationsRef.current.has(id)}
          onOpenNew={() => void selectPublication()}
          onOpenEntry={openLibraryEntry}
          onRemoveEntry={removeLibraryEntry}
          onDismissError={() => setOperationError(undefined)}
        />
      ) : (
        <main className="shell-content">
          <aside className="shell-panel shell-panel--contents" aria-label="Contents preview">
            <section className="publication-summary" aria-label="Current publication">
              {parsedPublication?.metadata.coverUrl ? (
                <img
                  className="publication-cover"
                  src={parsedPublication.metadata.coverUrl}
                  alt=""
                />
              ) : (
                <span className="publication-cover-placeholder" aria-hidden="true">
                  NR
                </span>
              )}
              <div className="publication-summary__text">
                <h2>
                  {parsedPublication?.metadata.title ??
                    publication?.displayName.replace(/\.epub$/i, '') ??
                    'No book selected'}
                </h2>
                <p>
                  {parsedPublication?.metadata.author ??
                    (publication ? 'Preparing book details…' : 'Open an EPUB to begin')}
                </p>
              </div>
            </section>

            <section className="contents-region" aria-label="Chapter contents">
              <header className="contents-region__header">
                <h2>Contents</h2>
                {parsedPublication ? (
                  <span>{parsedPublication.spineLength.toLocaleString()}</span>
                ) : null}
              </header>

              {parsedPublication ? (
                <>
                  <VirtualizedToc
                    items={parsedPublication.toc}
                    location={readerLocation}
                    progress={readerProgress}
                    busy={isNavigating}
                    onOpen={(item) => void openTocItem(item)}
                  />
                  <p className="contents-count">
                    {parsedPublication.spineLength.toLocaleString()} chapters
                  </p>
                </>
              ) : (
                <div className="contents-empty">
                  <span aria-hidden="true">—</span>
                  <p>{publication ? 'Preparing contents…' : 'No chapters to show'}</p>
                </div>
              )}
            </section>
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

          <AppearancePanel
            appearance={preferences.appearance}
            mode={preferences.mode}
            busy={isApplyingAppearance || browserReaderStatus === 'opening'}
            fullscreenAvailable={platform.capabilities.fullscreen}
            isFullscreen={windowState.isFullScreen}
            notices={notices}
            onAppearanceChange={changeAppearance}
            onModeChange={changeMode}
            onToggleFullscreen={toggleFullscreen}
          />
        </main>
      )}

      {screen === 'reader' ? (
        <nav className="mobile-reader-tabs" aria-label="Reader sections">
          {(
            [
              ['contents', 'Contents'],
              ['reader', 'Read'],
              ['appearance', 'Appearance'],
            ] as const
          ).map(([view, label]) => (
            <button
              key={view}
              type="button"
              className={mobileReaderView === view ? 'is-selected' : ''}
              aria-pressed={mobileReaderView === view}
              onClick={() => setMobileReaderView(view)}
            >
              {label}
            </button>
          ))}
        </nav>
      ) : null}

      {screen === 'reader' ? (
        <footer className="statusbar" aria-label="Reading progress">
          <span className="statusbar__label">Overall progress</span>
          <strong>{readerProgress ? `${overallPercent}%` : '—'}</strong>
          <div
            className="statusbar__track"
            role="progressbar"
            aria-label="Overall reading progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={overallPercent}
          >
            <span style={{ width: `${overallPercent}%` }} />
          </div>
          <span className="statusbar__chapter">
            Chapter {readerLocation ? `${chapterPercent}%` : '—'}
          </span>
          <span className="visually-hidden">
            {isBrowserPreview ? 'Browser' : 'Electron'} · source {publicationStatus}
          </span>
        </footer>
      ) : null}

      {isFocusMode ? (
        <button className="focus-exit" type="button" onClick={() => changeMode('dashboard')}>
          Exit focus
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
