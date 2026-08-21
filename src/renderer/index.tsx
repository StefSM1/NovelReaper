import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/literata/400.css';
import '@fontsource/literata/600.css';
import '@fontsource/lora/400.css';
import '@fontsource/merriweather/400.css';
import '@fontsource/source-serif-4/400.css';
import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app/App';
import { AppErrorBoundary } from './app/AppErrorBoundary';
import './styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('NovelReaper root element is missing.');

createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
