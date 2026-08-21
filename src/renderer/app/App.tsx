import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type {
  ReaderStateSnapshot,
  WindowStateSnapshot,
} from '../../shared/contracts/ipc';

const INITIAL_READER_STATE: ReaderStateSnapshot = {
  status: 'idle',
  generation: 0,
  canRetry: false,
};

const INITIAL_WINDOW_STATE: WindowStateSnapshot = {
  isMaximized: false,
  isFullScreen: false,
};

export function App(): React.JSX.Element {
  const readerFrameRef = useRef<HTMLDivElement>(null);
  const [readerState, setReaderState] = useState(INITIAL_READER_STATE);
  const [windowState, setWindowState] = useState(INITIAL_WINDOW_STATE);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string>();

  useEffect(() => {
    let mounted = true;
    void window.novelReaperShell
      .getBootstrapState()
      .then((state) => {
        if (!mounted) return;
        setReaderState(state.reader);
        setWindowState(state.window);
      })
      .catch(() => {
        if (mounted) setBootstrapError('The secure application bridge did not initialize.');
      });

    const unsubscribeReader = window.novelReaperShell.onReaderState(setReaderState);
    const unsubscribeWindow = window.novelReaperShell.onWindowState(setWindowState);
    const unsubscribeExitFocus = window.novelReaperShell.onExitFocusRequested(() => {
      setIsFocusMode(false);
    });

    return () => {
      mounted = false;
      unsubscribeReader();
      unsubscribeWindow();
      unsubscribeExitFocus();
    };
  }, []);

  const reportReaderBounds = useCallback(() => {
    const frame = readerFrameRef.current;
    if (!frame) return;

    const rect = frame.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;

    void window.novelReaperShell.setReaderBounds({
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    });
  }, []);

  useLayoutEffect(() => {
    reportReaderBounds();
    const frame = readerFrameRef.current;
    if (!frame) return;

    const observer = new ResizeObserver(reportReaderBounds);
    observer.observe(frame);
    window.addEventListener('resize', reportReaderBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', reportReaderBounds);
    };
  }, [isFocusMode, reportReaderBounds]);

  const recoverReader = (): void => {
    setReaderState((state) => ({ ...state, status: 'creating', canRetry: false }));
    void window.novelReaperShell.recoverReader().then(setReaderState).catch(() => {
      setReaderState((state) => ({
        ...state,
        status: 'crashed',
        canRetry: true,
        message: 'Reader recovery failed.',
      }));
    });
  };

  const toggleFullscreen = (): void => {
    void window.novelReaperShell
      .performWindowAction('toggle-fullscreen')
      .then(setWindowState);
  };

  return (
    <div className={isFocusMode ? 'app app--focus' : 'app'}>
      <header className="titlebar" data-testid="titlebar">
        <div className="titlebar__brand">
          <span aria-hidden="true" className="brand-mark">
            NR
          </span>
          <span>NovelReaper</span>
        </div>
      </header>

      <nav className="phase-toolbar" aria-label="Reader shell controls">
        <div>
          <p className="eyebrow">Phase 1</p>
          <strong>Secure reader shell</strong>
        </div>
        <div className="phase-toolbar__actions">
          <button type="button" onClick={() => setIsFocusMode((value) => !value)}>
            {isFocusMode ? 'Exit focus' : 'Focus mode'}
          </button>
          <button type="button" onClick={toggleFullscreen}>
            {windowState.isFullScreen ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        </div>
      </nav>

      <main className="shell-content">
        <aside className="shell-panel shell-panel--contents" aria-label="Contents placeholder">
          <p className="eyebrow">Contents</p>
          <h2>Library foundation</h2>
          <p>EPUB import and chapter navigation arrive in the next phases.</p>
        </aside>

        <section className="reader-column" aria-label="Reading surface">
          <div className="reader-frame" ref={readerFrameRef} data-testid="reader-frame">
            {readerState.status === 'crashed' ? (
              <div className="reader-fallback" role="alert">
                <p className="eyebrow">Reader isolated</p>
                <h2>The reading surface stopped responding.</h2>
                <p>{readerState.message ?? 'The application shell is still safe and usable.'}</p>
                <button type="button" disabled={!readerState.canRetry} onClick={recoverReader}>
                  Restart reading surface
                </button>
              </div>
            ) : (
              <span className="visually-hidden" aria-live="polite">
                Reader status: {readerState.status}
              </span>
            )}
          </div>
        </section>

        <aside className="shell-panel shell-panel--appearance" aria-label="Appearance placeholder">
          <p className="eyebrow">Appearance</p>
          <h2>Warm editorial</h2>
          <p>The bundled reading fonts and theme tokens are ready for the reader UI phase.</p>
        </aside>
      </main>

      <footer className="statusbar">
        <span>Reader: {readerState.status}</span>
        <span>Generation {readerState.generation}</span>
        <span>{windowState.isMaximized ? 'Maximized' : 'Windowed'}</span>
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
