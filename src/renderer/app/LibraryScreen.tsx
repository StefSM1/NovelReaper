import type { PublicationDescriptor } from '../../platform/contracts';

interface LibraryScreenProps {
  entries: PublicationDescriptor[];
  isSelecting: boolean;
  error: string | undefined;
  hasSessionFile: (id: string) => boolean;
  onOpenNew: () => void;
  onOpenEntry: (entry: PublicationDescriptor) => void;
  onRemoveEntry: (entry: PublicationDescriptor) => void;
  onDismissError: () => void;
}

function formatSections(count: number | undefined): string {
  return count ? `${count.toLocaleString()} sections` : 'Metadata available after opening';
}

export function LibraryScreen({
  entries,
  isSelecting,
  error,
  hasSessionFile,
  onOpenNew,
  onOpenEntry,
  onRemoveEntry,
  onDismissError,
}: LibraryScreenProps): React.JSX.Element {
  return (
    <main className="library-screen">
      <header className="library-screen__header">
        <div>
          <p className="eyebrow">Your library</p>
          <h1>Volumes waiting quietly.</h1>
          <p>
            Browser cards remember metadata and progress. Select a file again when browser access
            expires; NovelReaper never copies the EPUB.
          </p>
        </div>
      </header>

      {error ? (
        <div
          className="library-screen__error operation-message operation-message--error"
          role="alert"
        >
          <strong>Could not open that publication</strong>
          <span>{error}</span>
          <button type="button" onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      ) : null}

      {entries.length ? (
        <ul className="library-grid" aria-label="Saved publications">
          {entries.map((entry, index) => {
            const ready = hasSessionFile(entry.id);
            return (
              <li className="library-book" key={entry.id}>
                <div className="library-book__spine" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </div>
                <div className="library-book__body">
                  <p>{ready ? 'Ready this session' : 'Selection required'}</p>
                  <h2>{entry.title ?? entry.displayName.replace(/\.epub$/i, '')}</h2>
                  <span>{entry.author ?? entry.displayName}</span>
                  <small>{formatSections(entry.spineLength)}</small>
                  <div className="library-book__actions">
                    <button
                      className="button button--primary"
                      type="button"
                      onClick={() => onOpenEntry(entry)}
                    >
                      {ready ? 'Resume' : 'Select again'}
                    </button>
                    <button type="button" onClick={() => onRemoveEntry(entry)}>
                      Remove
                    </button>
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
            Choose an EPUB
          </button>
        </section>
      )}
    </main>
  );
}
