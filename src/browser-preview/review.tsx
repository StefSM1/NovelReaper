import type { NovelReaperPlatform, SelectedPublication } from '../platform/contracts';
import { createFoliateReaderEngine } from '../reader/FoliateReaderEngine';
import { renderNovelReaper } from '../renderer/render-app';
import { createSyntheticEpub } from '../../tests/fixtures/synthetic-epub';

const fixture = createSyntheticEpub();
const publication: SelectedPublication = {
  id: 'novelreaper-b5-review-fixture',
  displayName: fixture.name,
  fileSize: fixture.size,
  lastModified: fixture.lastModified,
  mimeType: fixture.type,
  availability: 'selected',
  file: fixture,
};

const capabilities = {
  selectLocalPublication: true,
  durableSourceAccess: false,
  relink: false,
  nativeWindowControls: false,
  fullscreen: false,
} as const;

const reviewPlatform: NovelReaperPlatform = {
  environment: 'browser-preview',
  capabilities,
  getBootstrapState: () =>
    Promise.resolve({
      appName: 'NovelReaper',
      appVersion: '0.1.0-b5-review',
      environment: 'browser-preview',
      capabilities,
      reader: { status: 'idle', generation: 0, canRetry: false },
      window: { isMaximized: false, isFullScreen: false },
      library: [],
      notices: ['B5 review fixture · development only'],
    }),
  selectPublication: () => Promise.resolve({ status: 'selected', publication }),
  updateLibraryPublication: () => Promise.resolve([]),
  removeLibraryPublication: () => Promise.resolve([]),
  setReaderBounds: () => Promise.resolve(),
  recoverReader: () => Promise.resolve({ status: 'ready', generation: 1, canRetry: false }),
  toggleFullscreen: () => Promise.resolve({ isMaximized: false, isFullScreen: false }),
  onReaderState: () => () => undefined,
  onWindowState: () => () => undefined,
  onExitFocusRequested: () => () => undefined,
};

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('NovelReaper B5 review root is missing.');

renderNovelReaper(rootElement, reviewPlatform, createFoliateReaderEngine);
