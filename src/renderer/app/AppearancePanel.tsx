import {
  READER_FONT_FAMILIES,
  READER_FONT_LABELS,
  type ReaderAppearanceSettings,
  type ReaderLineHeight,
  type ReaderPageWidth,
  type ReaderTheme,
} from '../../reader/appearance';
import type { ReaderMode } from '../../platform/browser/browser-settings-store';

interface AppearancePanelProps {
  appearance: ReaderAppearanceSettings;
  mode: ReaderMode;
  busy: boolean;
  fullscreenAvailable: boolean;
  isFullscreen: boolean;
  notices: string[];
  onAppearanceChange: (update: Partial<ReaderAppearanceSettings>) => void;
  onModeChange: (mode: ReaderMode) => void;
  onToggleFullscreen: () => void;
}

const LINE_HEIGHTS: ReaderLineHeight[] = [1.4, 1.6, 1.8];
const PAGE_WIDTHS: ReaderPageWidth[] = [54, 68, 82];

const LINE_HEIGHT_LABELS: Record<ReaderLineHeight, string> = {
  1.4: 'Compact',
  1.6: 'Standard',
  1.8: 'Relaxed',
};

const PAGE_WIDTH_LABELS: Record<ReaderPageWidth, string> = {
  54: 'Narrow',
  68: 'Comfort',
  82: 'Wide',
};

export function AppearancePanel({
  appearance,
  mode,
  busy,
  fullscreenAvailable,
  isFullscreen,
  notices,
  onAppearanceChange,
  onModeChange,
  onToggleFullscreen,
}: AppearancePanelProps): React.JSX.Element {
  const setTheme = (theme: ReaderTheme): void => onAppearanceChange({ theme });

  return (
    <aside className="shell-panel shell-panel--appearance" aria-label="Appearance">
      <h2>Appearance</h2>

      <div className="appearance-control">
        <span className="appearance-control__label">Theme</span>
        <div className="segmented-control" aria-label="Theme">
          {(['light', 'dark'] as const).map((theme) => (
            <button
              key={theme}
              type="button"
              className={appearance.theme === theme ? 'is-selected' : ''}
              aria-pressed={appearance.theme === theme}
              disabled={busy}
              onClick={() => setTheme(theme)}
            >
              {theme === 'light' ? 'Light' : 'Dark'}
            </button>
          ))}
        </div>
      </div>

      <label className="appearance-control">
        <span className="appearance-control__label">Font</span>
        <select
          value={appearance.fontFamily}
          disabled={busy}
          onChange={(event) =>
            onAppearanceChange({
              fontFamily: event.currentTarget.value as ReaderAppearanceSettings['fontFamily'],
            })
          }
        >
          {READER_FONT_FAMILIES.map((font) => (
            <option key={font} value={font}>
              {READER_FONT_LABELS[font]}
            </option>
          ))}
        </select>
      </label>

      <div className="appearance-control appearance-stepper">
        <span className="appearance-control__label">Font size</span>
        <button
          type="button"
          aria-label="Decrease font size"
          disabled={busy || appearance.fontSizePx <= 14}
          onClick={() => onAppearanceChange({ fontSizePx: appearance.fontSizePx - 1 })}
        >
          −
        </button>
        <output aria-live="polite">{appearance.fontSizePx}</output>
        <button
          type="button"
          aria-label="Increase font size"
          disabled={busy || appearance.fontSizePx >= 30}
          onClick={() => onAppearanceChange({ fontSizePx: appearance.fontSizePx + 1 })}
        >
          +
        </button>
      </div>

      <fieldset className="appearance-control">
        <legend>Line spacing</legend>
        <div className="segmented-control segmented-control--three">
          {LINE_HEIGHTS.map((lineHeight) => (
            <button
              key={lineHeight}
              type="button"
              className={appearance.lineHeight === lineHeight ? 'is-selected' : ''}
              aria-pressed={appearance.lineHeight === lineHeight}
              aria-label={`${LINE_HEIGHT_LABELS[lineHeight]} line spacing`}
              title={LINE_HEIGHT_LABELS[lineHeight]}
              disabled={busy}
              onClick={() => onAppearanceChange({ lineHeight })}
            >
              <span
                className={`line-spacing-glyph line-spacing-glyph--${LINE_HEIGHT_LABELS[
                  lineHeight
                ].toLocaleLowerCase()}`}
                aria-hidden="true"
              >
                <i />
                <i />
                <i />
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="appearance-control">
        <legend>Page width</legend>
        <div className="segmented-control segmented-control--three">
          {PAGE_WIDTHS.map((pageWidthCh) => (
            <button
              key={pageWidthCh}
              type="button"
              className={appearance.pageWidthCh === pageWidthCh ? 'is-selected' : ''}
              aria-pressed={appearance.pageWidthCh === pageWidthCh}
              aria-label={`${PAGE_WIDTH_LABELS[pageWidthCh]} page width`}
              title={PAGE_WIDTH_LABELS[pageWidthCh]}
              disabled={busy}
              onClick={() => onAppearanceChange({ pageWidthCh })}
            >
              <span
                className={`page-width-glyph page-width-glyph--${PAGE_WIDTH_LABELS[
                  pageWidthCh
                ].toLocaleLowerCase()}`}
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </fieldset>

      <div className="appearance-action">
        <div>
          <strong>Focus mode</strong>
          <small>Hide the surrounding reading controls.</small>
        </div>
        <button
          className="switch-control"
          type="button"
          role="switch"
          aria-checked={mode === 'focus'}
          disabled={busy}
          onClick={() => onModeChange(mode === 'focus' ? 'dashboard' : 'focus')}
        >
          <span />
          <span className="visually-hidden">Toggle focus mode</span>
        </button>
      </div>

      <button
        className="button button--wide"
        type="button"
        disabled={!fullscreenAvailable}
        onClick={onToggleFullscreen}
      >
        {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
      </button>

      <div className="strict-status">
        <strong>Strict EPUB safety</strong>
        <small>Scripts and outbound book requests remain blocked.</small>
      </div>

      {notices.map((notice) => (
        <div className="operation-message" role="status" key={notice}>
          {notice}
        </div>
      ))}
    </aside>
  );
}
