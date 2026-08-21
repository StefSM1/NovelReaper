import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

import {
  app,
  session,
  WebContentsView,
  type BrowserWindow,
  type Session,
  type WebPreferences,
} from 'electron';

import {
  IPC_CHANNELS,
  mainToReaderCommandSchema,
  type ReaderBounds,
  type ReaderStateSnapshot,
  readerToMainEventSchema,
} from '../../shared/contracts/ipc';
import { registerBundledAssetProtocol } from '../protocol/bundled-assets';
import {
  isSameDocumentNavigation,
  READER_SCHEME,
  serializedOrigin,
} from '../protocol/schemes';
import { attachContentGuards, type GuardFailure } from '../security/content-guards';
import { authorizeTopFrameIpc } from '../security/ipc-authorization';
import { installSessionDenyPolicy } from '../security/session-policy';
import { createSecureWebPreferences } from '../security/web-preferences';

interface ActiveReader {
  capability: string;
  cleanups: Array<() => void>;
  expectedOrigin: string;
  generation: number;
  session: Session;
  view: WebContentsView;
  webPreferences: WebPreferences;
}

export interface SecurityPreferencesSnapshot {
  sandbox: boolean;
  contextIsolation: boolean;
  nodeIntegration: boolean;
  nodeIntegrationInWorker: boolean;
  nodeIntegrationInSubFrames: boolean;
  webSecurity: boolean;
  webviewTag: boolean;
}

export interface ReaderDiagnostics {
  generation: number;
  status: ReaderStateSnapshot['status'];
  shell: {
    id: number;
    osProcessId: number;
    url: string;
    webPreferences: SecurityPreferencesSnapshot;
  };
  reader?: {
    id: number;
    osProcessId: number;
    url: string;
    isSessionPersistent: boolean;
    sessionStoragePath: string | null;
    webPreferences: SecurityPreferencesSnapshot;
  };
}

function activeBoolean(value: boolean | undefined): boolean {
  return value === true;
}

function securityPreferencesSnapshot(
  preferences: WebPreferences,
): SecurityPreferencesSnapshot {
  return {
    sandbox: activeBoolean(preferences.sandbox),
    contextIsolation: activeBoolean(preferences.contextIsolation),
    nodeIntegration: activeBoolean(preferences.nodeIntegration),
    nodeIntegrationInWorker: activeBoolean(preferences.nodeIntegrationInWorker),
    nodeIntegrationInSubFrames: activeBoolean(preferences.nodeIntegrationInSubFrames),
    webSecurity: activeBoolean(preferences.webSecurity),
    webviewTag: activeBoolean(preferences.webviewTag),
  };
}

export class ReaderViewManager {
  private active: ActiveReader | undefined;
  private generation = 0;
  private lastBounds: ReaderBounds = { x: 0, y: 120, width: 800, height: 600 };
  private state: ReaderStateSnapshot = {
    status: 'idle',
    generation: 0,
    canRetry: false,
  };
  private transition: Promise<void> = Promise.resolve();

  public constructor(
    private readonly window: BrowserWindow,
    private readonly shellWebPreferences: WebPreferences,
    private readonly onState: (state: ReaderStateSnapshot) => void,
    private readonly onKeyboardEscape: () => void,
    private readonly onKeyboardFullscreen: () => void,
  ) {
    this.window.on('resize', this.handleWindowResize);
  }

  public getState(): ReaderStateSnapshot {
    return { ...this.state };
  }

  public async create(): Promise<ReaderStateSnapshot> {
    return this.enqueue(async () => {
      await this.disposeActive(false);
      const generation = ++this.generation;
      this.updateState({ status: 'creating', generation, canRetry: false });

      const capability = randomBytes(18).toString('hex');
      const readerSession = session.fromPartition(`novelreaper-reader-${randomUUID()}`, {
        cache: false,
      });
      const cleanups: Array<() => void> = [];

      try {
        cleanups.push(
          installSessionDenyPolicy({
            session: readerSession,
            ...(!app.isPackaged ? { developmentEntryUrl: READER_WINDOW_WEBPACK_ENTRY } : {}),
          }),
        );

        const loadUrl = app.isPackaged
          ? `${READER_SCHEME}://${capability}/index.html`
          : READER_WINDOW_WEBPACK_ENTRY;

        if (app.isPackaged) {
          cleanups.push(
            registerBundledAssetProtocol({
              session: readerSession,
              scheme: READER_SCHEME,
              host: capability,
              entryUrl: READER_WINDOW_WEBPACK_ENTRY,
            }),
          );
        }

        const webPreferences = createSecureWebPreferences(
          READER_WINDOW_PRELOAD_WEBPACK_ENTRY,
          readerSession,
        );
        const view = new WebContentsView({
          webPreferences,
        });
        const expectedOrigin = serializedOrigin(loadUrl);
        const active: ActiveReader = {
          capability,
          cleanups,
          expectedOrigin,
          generation,
          session: readerSession,
          view,
          webPreferences,
        };
        this.active = active;

        cleanups.push(
          attachContentGuards({
            contents: view.webContents,
            isNavigationAllowed: (url) => isSameDocumentNavigation(url, loadUrl),
            onKeyboardEscape: this.onKeyboardEscape,
            onKeyboardFullscreen: this.onKeyboardFullscreen,
            onFailure: (failure) => this.handleFailure(generation, failure),
          }),
        );

        const onReaderEvent = (event: Electron.IpcMainEvent, payload: unknown): void => {
          if (this.active?.generation !== generation) return;

          try {
            authorizeTopFrameIpc(event, view.webContents, readerSession, expectedOrigin);
            const parsed = readerToMainEventSchema.parse(payload);

            if (parsed.type === 'ready') {
              const shellPid = this.window.webContents.getOSProcessId();
              const readerPid = view.webContents.getOSProcessId();
              if (shellPid === 0 || readerPid === 0 || shellPid === readerPid) {
                void this.failGeneration(
                  generation,
                  'Reader process isolation could not be verified.',
                );
                return;
              }
              this.updateState({ status: 'ready', generation, canRetry: false });
              const ping = mainToReaderCommandSchema.parse({
                type: 'ping',
                nonce: randomUUID(),
              });
              view.webContents.send(IPC_CHANNELS.readerCommand, ping);
            }

            if (parsed.type === 'reader-error' && parsed.fatal) {
              void this.failGeneration(generation, parsed.message);
            }
          } catch (error) {
            console.warn('Rejected reader IPC event', error);
          }
        };

        view.webContents.ipc.on(IPC_CHANNELS.readerEvent, onReaderEvent);
        cleanups.push(() => {
          view.webContents.ipc.removeListener(IPC_CHANNELS.readerEvent, onReaderEvent);
        });

        this.window.contentView.addChildView(view);
        this.applyBounds(view, this.lastBounds);
        this.updateState({ status: 'loading', generation, canRetry: false });
        await view.webContents.loadURL(loadUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Reader initialization failed.';
        await this.disposeActive(false);
        this.updateState({ status: 'crashed', generation, canRetry: true, message });
      }

      return this.getState();
    });
  }

  public async recover(): Promise<ReaderStateSnapshot> {
    return this.create();
  }

  public setBounds(bounds: ReaderBounds): void {
    this.lastBounds = this.clampBounds(bounds);
    if (this.active && !this.active.view.webContents.isDestroyed()) {
      this.applyBounds(this.active.view, this.lastBounds);
    }
  }

  public async dispose(): Promise<void> {
    await this.enqueue(async () => {
      await this.disposeActive(true);
      this.window.removeListener('resize', this.handleWindowResize);
    });
  }

  public getDiagnostics(): ReaderDiagnostics {
    const shellContents = this.window.webContents;
    const base: ReaderDiagnostics = {
      generation: this.generation,
      status: this.state.status,
      shell: {
        id: shellContents.id,
        osProcessId: shellContents.getOSProcessId(),
        url: shellContents.getURL(),
        webPreferences: securityPreferencesSnapshot(this.shellWebPreferences),
      },
    };

    if (!this.active || this.active.view.webContents.isDestroyed()) return base;

    const contents = this.active.view.webContents;
    return {
      ...base,
      reader: {
        id: contents.id,
        osProcessId: contents.getOSProcessId(),
        url: contents.getURL(),
        isSessionPersistent: this.active.session.isPersistent(),
        sessionStoragePath: this.active.session.storagePath,
        webPreferences: securityPreferencesSnapshot(this.active.webPreferences),
      },
    };
  }

  public forceReaderCrashForTest(): void {
    const reader = this.active?.view.webContents;
    if (!reader || reader.isDestroyed()) throw new Error('No active reader to crash.');

    const shellPid = this.window.webContents.getOSProcessId();
    const readerPid = reader.getOSProcessId();
    if (shellPid === 0 || readerPid === 0 || shellPid === readerPid) {
      throw new Error('Refusing to crash a reader without verified process isolation.');
    }
    reader.forcefullyCrashRenderer();
  }

  private readonly handleWindowResize = (): void => {
    if (this.active && !this.active.view.webContents.isDestroyed()) {
      this.lastBounds = this.clampBounds(this.lastBounds);
      this.applyBounds(this.active.view, this.lastBounds);
    }
  };

  private applyBounds(view: WebContentsView, bounds: ReaderBounds): void {
    view.setBounds(bounds);
  }

  private clampBounds(bounds: ReaderBounds): ReaderBounds {
    const contentBounds = this.window.getContentBounds();
    const x = Math.min(Math.max(0, Math.round(bounds.x)), Math.max(0, contentBounds.width - 1));
    const y = Math.min(Math.max(0, Math.round(bounds.y)), Math.max(0, contentBounds.height - 1));
    const width = Math.max(1, Math.min(Math.round(bounds.width), contentBounds.width - x));
    const height = Math.max(1, Math.min(Math.round(bounds.height), contentBounds.height - y));
    return { x, y, width, height };
  }

  private updateState(state: ReaderStateSnapshot): void {
    this.state = state;
    this.onState(this.getState());
  }

  private handleFailure(generation: number, failure: GuardFailure): void {
    if (this.active?.generation !== generation) return;
    void this.failGeneration(generation, failure.message);
  }

  private async failGeneration(generation: number, message: string): Promise<void> {
    if (this.active?.generation !== generation) return;
    await this.disposeActive(false);
    this.updateState({ status: 'crashed', generation, canRetry: true, message });
  }

  private async disposeActive(setDestroyedState: boolean): Promise<void> {
    const active = this.active;
    if (!active) {
      if (setDestroyedState) {
        this.updateState({
          status: 'destroyed',
          generation: this.generation,
          canRetry: false,
        });
      }
      return;
    }

    this.active = undefined;
    const contents = active.view.webContents;

    if (!contents.isDestroyed()) {
      contents.send(IPC_CHANNELS.readerCommand, { type: 'prepare-close' });
    }
    for (const cleanup of active.cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.warn('Reader cleanup step failed', error);
      }
    }

    if (!this.window.isDestroyed()) {
      active.view.setVisible(false);
      this.window.contentView.removeChildView(active.view);
    }

    if (!contents.isDestroyed()) {
      const destroyed = once(contents, 'destroyed');
      contents.close({ waitForBeforeUnload: false });
      await Promise.race([destroyed, delay(1_000)]);
    }

    await Promise.allSettled([
      active.session.closeAllConnections(),
      active.session.clearData(),
      active.session.clearAuthCache(),
    ]);

    if (setDestroyedState) {
      this.updateState({
        status: 'destroyed',
        generation: this.generation,
        canRetry: false,
      });
    }
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.transition;
    let release: () => void = () => undefined;
    this.transition = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}
