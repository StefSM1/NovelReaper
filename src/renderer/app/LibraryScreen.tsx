import { useState } from 'react';

import type { PublicationDescriptor } from '../../platform/contracts';
import type { StoredReaderProgress } from '../../reader/progress-state';

interface LibraryScreenProps {
  entries: PublicationDescriptor[];
  progressByBook: Record<string, StoredReaderProgress>;
  isLoading: boolean;
  isSelecting: boolean;
  error: string | undefined;
  hasSessionFile: (id: string) => boolean;
  onOpenNew: () => void;
  onOpenEntry: (entry: PublicationDescriptor) => void;
  onRemoveEntry: (entry: PublicationDescriptor) => Promise<boolean>;
  onDismissError: () => void;
}

function formatSections(count: number | undefined): string {
  return count ? `${count.toLocaleString()} sections` : 'Metadata available after opening';
}

export function LibraryScreen({
  entries,
  progressByBook,
  isLoading,
  isSelecting,
  error,
  hasSessionFile,
  onOpenNew,
  onOpenEntry,
  onRemoveEntry,
  onDismissError,
}: LibraryScreenProps): React.JSX.Element {
  const [pendingRemovalId, setPendingRemovalId] = useState<string>();
  const [removingId, setRemovingId] = useState<string>();

  const confirmRemoval = async (entry: PublicationDescriptor): Promise<void> => {
    if (removingId) return;
    setRemovingId(entry.id);
    const removed = await onRemoveEntry(entry);
    setRemovingId(undefined);
    if (removed) setPendingRemovalId(undefined);
  };

  return (
    <main className="library-screen">
      <header className="library-screen__header">
        <div>
          <p className="eyebrow">Your library</p>
          <h1>Volumes waiting quietly.</h1>
          <p>
            Import a volume once, then resume where you left off. Saved EPUB copies and reading
            progress stay in this browser on this device. Nothing is uploaded.
          </p>
          <p className="library-screen__storage-note">
            Keep your original EPUBs. Clearing site data or using a different browser or address
            opens a separate library.
          </p>
        </div>
      </header>

      {error ? (
        <div
          className="library-screen__error operation-message operation-message--error"
          role="alert"
        >
          <strong>Library action could not be completed</strong>
          <span>{error}</span>
          <button type="button" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      ) : null}

      {isLoading && !entries.length ? (
        <section className="library-loading" role="status" aria-label="Loading library">
          <span className="library-loading__mark" aria-hidden="true">
            NR
          </span>
          <h2>Opening your library…</h2>
          <div className="library-loading__lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </section>
      ) : entries.length ? (
        <ul className="library-grid" aria-label="Saved publications">
          {entries.map((entry, index) => {
            const ready = hasSessionFile(entry.id);
            const stored = entry.availability === 'stored';
            const progress = progressByBook[entry.id];
            const position = progress?.positions[String(progress.currentSpineIndex)];
            return (
              <li className="library-book" key={entry.id}>
                <div className="library-book__spine" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <div className="library-book__body">
                  <p>
                    {stored
                      ? 'Saved on this device'
                      : ready
                        ? 'This session only'
                        : 'Select once to save locally'}
                  </p>
                  <h2>{entry.title ?? entry.displayName.replace(/\.epub$/i, '')}</h2>
                  <span>{entry.author ?? entry.displayName}</span>
                  <small>{formatSections(entry.spineLength)}</small>
                  {progress ? (
                    <small className="library-book__progress">
                      {progress.finished
                        ? 'Book completed'
                        : `Last read: section ${progress.currentSpineIndex + 1}${position ? ` · ${Math.round(position.fractionInChapter * 100)}% through section` : ''}`}
                    </small>
                  ) : null}
                  <div className="library-book__actions">
                    <button
                      className="button button--primary"
                      type="button"
                      disabled={isSelecting || Boolean(removingId)}
                      onClick={() => onOpenEntry(entry)}
                    >
                      {isSelecting ? 'Opening…' : ready || stored ? 'Resume' : 'Select again'}
                    </button>
                    {pendingRemovalId === entry.id ? (
                      <div
                        className="library-book__remove-confirmation"
                        role="group"
                        aria-label={`Remove ${entry.title ?? entry.displayName} from the library`}
                      >
                        <span role="status">
                          {stored
                            ? 'Remove the local EPUB copy? Progress and your original file are kept.'
                            : 'Remove card?'}
                        </span>
                        <button
                          type="button"
                          disabled={removingId === entry.id}
                          onClick={() => setPendingRemovalId(undefined)}
                        >
                          Keep
                        </button>
                        <button
                          className="button--danger"
                          type="button"
                          disabled={removingId === entry.id}
                          onClick={() => void confirmRemoval(entry)}
                        >
                          {removingId === entry.id
                            ? 'Removing…'
                            : stored
                              ? 'Remove copy'
                              : 'Remove card'}
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={isSelecting || Boolean(removingId)}
                        onClick={() => setPendingRemovalId(entry.id)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <section className="library-empty">
          <span aria-hidden="true">NR</span>
          <h2>No volumes yet</h2>
          <p>Open your first local EPUB to add its reading card.</p>
          <button
            className="button button--primary"
            type="button"
            disabled={isSelecting}
            onClick={onOpenNew}
          >
            {isSelecting ? 'Opening…' : 'Choose an EPUB'}
          </button>
        </section>
      )}
    </main>
  );
}
