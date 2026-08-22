import {
  ReaderEngineError,
  type ReaderEngine,
  type ReaderNavigationRequest,
  type ReaderNavigationTarget,
  type ReaderRelocation,
} from './contracts';
import {
  readerProgressReducer,
  storedReaderProgress,
  type ReaderProgressState,
  type StoredReaderProgress,
} from './progress-state';

interface ReaderNavigationServiceOptions {
  engine: ReaderEngine;
  initialState: ReaderProgressState;
  onState: (state: ReaderProgressState, location?: ReaderRelocation) => void;
  onBusy: (busy: boolean) => void;
  flush: (state: StoredReaderProgress) => void;
}

export class ReaderNavigationService {
  private state: ReaderProgressState;
  private busy = false;

  public constructor(private readonly options: ReaderNavigationServiceOptions) {
    this.state = options.initialState;
    this.syncFooter();
  }

  public get currentState(): ReaderProgressState {
    return this.state;
  }

  public relocate(location: ReaderRelocation): void {
    const next = readerProgressReducer(this.state, { type: 'relocate', location });
    if (next === this.state) return;
    this.state = next;
    this.options.onState(this.state, location);
    this.syncFooter();
  }

  public async navigate(request: ReaderNavigationRequest): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    this.options.onBusy(true);
    this.syncFooter();
    this.options.flush(storedReaderProgress(this.state));

    const fromSpineIndex = this.state.currentSpineIndex;
    try {
      if (request.source === 'finish') {
        const finalIndex = this.state.linearSpineIndices.at(-1);
        if (fromSpineIndex !== finalIndex) return false;
        this.state = readerProgressReducer(this.state, {
          type: 'finish',
          spineIndex: fromSpineIndex,
        });
        this.options.onState(this.state);
        this.options.flush(storedReaderProgress(this.state));
        return true;
      }

      const target = this.resolveTarget(request);
      if (target === undefined) return false;
      await this.options.engine.goTo(target);
      const destinationSpineIndex = this.state.currentSpineIndex;
      this.state = readerProgressReducer(this.state, {
        type: 'navigate',
        source: request.source,
        fromSpineIndex,
        destinationSpineIndex,
      });
      this.options.onState(this.state);
      if (request.source === 'next') this.options.flush(storedReaderProgress(this.state));
      return true;
    } finally {
      this.busy = false;
      this.options.onBusy(false);
      this.syncFooter();
    }
  }

  public flush(): void {
    this.options.flush(storedReaderProgress(this.state));
  }

  private resolveTarget(
    request: Exclude<ReaderNavigationRequest, { source: 'finish' }>,
  ): ReaderNavigationTarget | undefined {
    if (request.source === 'contents' || request.source === 'internal') return request.target;
    const position = this.state.linearSpineIndices.indexOf(this.state.currentSpineIndex);
    if (position < 0) return undefined;
    if (request.source === 'previous') return this.state.linearSpineIndices[position - 1];
    return this.state.linearSpineIndices[position + 1];
  }

  private syncFooter(): void {
    this.options.engine.setNavigationState({ busy: this.busy, finished: this.state.finished });
  }
}

export function navigationErrorMessage(error: unknown): string {
  if (error instanceof ReaderEngineError) return error.message;
  return 'That navigation action could not be completed. Your last reading position is still saved.';
}
