import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

export const COMPACT_READER_QUERY = '(max-width: 1050px)';

function subscribeToViewport(onChange: () => void): () => void {
  const query = window.matchMedia?.(COMPACT_READER_QUERY);
  query?.addEventListener('change', onChange);
  return () => query?.removeEventListener('change', onChange);
}

export function useCompactReader(): boolean {
  return useSyncExternalStore(
    subscribeToViewport,
    () => window.matchMedia?.(COMPACT_READER_QUERY).matches ?? false,
    () => false,
  );
}

interface MobileReaderPanelProps {
  compact: boolean;
  open: boolean;
  kind: 'contents' | 'appearance';
  onDismiss: () => void;
  error?: string | undefined;
  children: ReactNode;
}

export function MobileReaderPanel({
  compact,
  open,
  kind,
  onDismiss,
  error,
  children,
}: MobileReaderPanelProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const title = kind === 'contents' ? 'Chapters' : 'Appearance';

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!compact || !dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [compact, open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!compact || !dialog) return;
    // The native backdrop retargets pointer clicks to the dialog. Keyboard users
    // have the Close button and the dialog's native Escape/cancel event.
    const dismissBackdrop = (event: MouseEvent): void => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      )
        onDismiss();
    };
    dialog.addEventListener('click', dismissBackdrop);
    return () => dialog.removeEventListener('click', dismissBackdrop);
  }, [compact, onDismiss]);

  if (!compact) return <>{children}</>;
  return (
    <dialog
      ref={dialogRef}
      className={`mobile-panel mobile-panel--${kind}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
    >
      <header className="mobile-panel__header">
        <h2>{title}</h2>
        <button type="button" onClick={onDismiss} aria-label={`Close ${title.toLowerCase()}`}>
          Close
        </button>
        {error ? (
          <p className="mobile-panel__error" role="alert">
            {error}
          </p>
        ) : null}
      </header>
      <div className="mobile-panel__body">{children}</div>
    </dialog>
  );
}
