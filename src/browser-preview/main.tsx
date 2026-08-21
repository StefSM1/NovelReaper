import { createBrowserPlatform } from '../platform/browser/browser-platform';
import { renderNovelReaper } from '../renderer/render-app';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('NovelReaper browser-preview root is missing.');

renderNovelReaper(rootElement, createBrowserPlatform());
