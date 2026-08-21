import '@testing-library/jest-dom/vitest';

import { afterEach, vi } from 'vitest';

class ResizeObserverStub implements ResizeObserver {
  public constructor(private readonly callback: ResizeObserverCallback) {}

  public disconnect(): void {}

  public observe(target: Element): void {
    this.callback(
      [
        {
          target,
          contentRect: target.getBoundingClientRect(),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      this,
    );
  }

  public unobserve(): void {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverStub);

if (typeof document !== 'undefined') {
  afterEach(() => {
    document.body.replaceChildren();
  });
}
