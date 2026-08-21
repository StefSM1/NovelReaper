import { app, type Session, type WebPreferences } from 'electron';

export function createSecureWebPreferences(preload: string, session: Session): WebPreferences {
  return {
    preload,
    session,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    plugins: false,
    experimentalFeatures: false,
    enableWebSQL: false,
    navigateOnDragDrop: false,
    disableDialogs: true,
    spellcheck: false,
    backgroundThrottling: true,
    autoplayPolicy: 'document-user-activation-required',
    devTools: !app.isPackaged && process.env.NOVELREAPER_DEVTOOLS === '1',
  };
}
