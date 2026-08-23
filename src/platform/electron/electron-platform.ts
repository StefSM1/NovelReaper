import type { NovelReaperShellApi } from '../../shared/contracts/ipc';
import type {
  NovelReaperPlatform,
  PlatformBootstrapState,
  PlatformCapabilities,
  PublicationDescriptor,
  PublicationSelectionResult,
} from '../contracts';

export class ElectronPlatformAdapter implements NovelReaperPlatform {
  public readonly environment = 'electron' as const;
  public readonly capabilities: PlatformCapabilities = Object.freeze({
    selectLocalPublication: false,
    durableSourceAccess: false,
    relink: false,
    nativeWindowControls: true,
    fullscreen: true,
  });

  public constructor(private readonly bridge: NovelReaperShellApi) {}

  public async getBootstrapState(): Promise<PlatformBootstrapState> {
    const state = await this.bridge.getBootstrapState();
    return {
      ...state,
      environment: this.environment,
      capabilities: this.capabilities,
      library: [],
      notices: [],
    };
  }

  public selectPublication(): Promise<PublicationSelectionResult> {
    return Promise.resolve({
      status: 'unsupported',
      reason: 'Desktop EPUB import is scheduled for Desktop Phase D2.',
    });
  }

  public updateLibraryPublication(): Promise<PublicationDescriptor[]> {
    return Promise.resolve([]);
  }

  public removeLibraryPublication(): Promise<PublicationDescriptor[]> {
    return Promise.resolve([]);
  }

  public setReaderBounds(
    bounds: Parameters<NovelReaperShellApi['setReaderBounds']>[0],
  ): Promise<void> {
    return this.bridge.setReaderBounds(bounds);
  }

  public recoverReader(): ReturnType<NovelReaperShellApi['recoverReader']> {
    return this.bridge.recoverReader();
  }

  public async toggleFullscreen(): Promise<{ isMaximized: boolean; isFullScreen: boolean }> {
    return this.bridge.performWindowAction('toggle-fullscreen');
  }

  public onReaderState(listener: Parameters<NovelReaperShellApi['onReaderState']>[0]): () => void {
    return this.bridge.onReaderState(listener);
  }

  public onWindowState(listener: Parameters<NovelReaperShellApi['onWindowState']>[0]): () => void {
    return this.bridge.onWindowState(listener);
  }

  public onExitFocusRequested(listener: () => void): () => void {
    return this.bridge.onExitFocusRequested(listener);
  }
}

export function createElectronPlatform(bridge: NovelReaperShellApi): ElectronPlatformAdapter {
  return new ElectronPlatformAdapter(bridge);
}
