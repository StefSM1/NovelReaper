import { createElectronPlatform } from '../platform/electron/electron-platform';
import { renderNovelReaper } from './render-app';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('NovelReaper root element is missing.');

renderNovelReaper(rootElement, createElectronPlatform(window.novelReaperShell));
