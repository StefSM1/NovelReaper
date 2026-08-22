import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/literata/400.css';
import '@fontsource/literata/600.css';
import '@fontsource/lora/400.css';
import '@fontsource/merriweather/400.css';
import '@fontsource/source-serif-4/400.css';
import React from 'react';
import { createRoot } from 'react-dom/client';

import type { NovelReaperPlatform } from '../platform/contracts';
import type { ReaderEngineFactory } from '../reader/contracts';
import { App } from './app/App';
import { AppErrorBoundary } from './app/AppErrorBoundary';
import './styles/global.css';

export function renderNovelReaper(
  rootElement: HTMLElement,
  platform: NovelReaperPlatform,
  readerEngineFactory?: ReaderEngineFactory,
): void {
  createRoot(rootElement).render(
    <React.StrictMode>
      <AppErrorBoundary>
        <App platform={platform} {...(readerEngineFactory ? { readerEngineFactory } : {})} />
      </AppErrorBoundary>
    </React.StrictMode>,
  );
}
