import { describe, expect, it, vi } from 'vitest';

import type { ReaderEngine, ReaderRelocation } from '../../../src/reader/contracts';
import { ReaderNavigationService } from '../../../src/reader/navigation-service';
import { createReaderProgress } from '../../../src/reader/progress-state';

function relocation(spineIndex: number): ReaderRelocation {
  return { spineIndex, href: `text/${spineIndex}.xhtml`, fractionInChapter: 0 };
}

describe('serialized reader navigation', () => {
  it('routes Next through one transaction and flushes its completion', async () => {
    const serviceRef: { current?: ReaderNavigationService } = {};
    const engine: ReaderEngine = {
      applyAppearance: vi.fn().mockResolvedValue(undefined),
      applySafetyLevel: vi.fn().mockResolvedValue(undefined),
      open: vi.fn(),
      goTo: vi.fn((target) => {
        serviceRef.current?.relocate(relocation(Number(target)));
        return Promise.resolve();
      }),
      setNavigationState: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      destroy: vi.fn(),
    };
    const flush = vi.fn();
    const service = new ReaderNavigationService({
      engine,
      initialState: createReaderProgress([0, 1, 2], undefined, relocation(0)),
      onState: vi.fn(),
      onBusy: vi.fn(),
      flush,
    });
    serviceRef.current = service;

    expect(await service.navigate({ source: 'next' })).toBe(true);
    expect(engine.goTo).toHaveBeenCalledWith(1);
    expect(service.currentState.currentSpineIndex).toBe(1);
    expect(service.currentState.completedSpineIndices).toEqual([0]);
    expect(flush).toHaveBeenLastCalledWith(expect.objectContaining({ completedSpineIndices: [0] }));
    expect(flush.mock.lastCall?.[0]).not.toHaveProperty('linearSpineIndices');
  });

  it('rejects repeated input while a navigation is pending', async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine: ReaderEngine = {
      applyAppearance: vi.fn().mockResolvedValue(undefined),
      applySafetyLevel: vi.fn().mockResolvedValue(undefined),
      open: vi.fn(),
      goTo: vi.fn(() => pending),
      setNavigationState: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      destroy: vi.fn(),
    };
    const service = new ReaderNavigationService({
      engine,
      initialState: createReaderProgress([0, 1], undefined, relocation(0)),
      onState: vi.fn(),
      onBusy: vi.fn(),
      flush: vi.fn(),
    });

    const first = service.navigate({ source: 'next' });
    expect(await service.navigate({ source: 'next' })).toBe(false);
    expect(engine.goTo).toHaveBeenCalledOnce();
    release?.();
    await first;
  });

  it('does not complete chapters through Previous or Contents', async () => {
    const serviceRef: { current?: ReaderNavigationService } = {};
    const engine: ReaderEngine = {
      applyAppearance: vi.fn().mockResolvedValue(undefined),
      applySafetyLevel: vi.fn().mockResolvedValue(undefined),
      open: vi.fn(),
      goTo: vi.fn((target) => {
        serviceRef.current?.relocate(relocation(Number(target)));
        return Promise.resolve();
      }),
      setNavigationState: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
      destroy: vi.fn(),
    };
    const service = new ReaderNavigationService({
      engine,
      initialState: createReaderProgress([0, 1, 2], undefined, relocation(1)),
      onState: vi.fn(),
      onBusy: vi.fn(),
      flush: vi.fn(),
    });
    serviceRef.current = service;

    await service.navigate({ source: 'previous' });
    await service.navigate({ source: 'contents', target: 2 });
    expect(service.currentState.completedSpineIndices).toEqual([]);
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores %s and relocation after disposal',
    async (outcome) => {
      let release!: () => void;
      const pending = new Promise<void>((resolve, reject) => {
        release = () =>
          outcome === 'resolve' ? resolve() : reject(new Error('Old navigation failed'));
      });
      const engine: ReaderEngine = {
        applyAppearance: vi.fn(),
        applySafetyLevel: vi.fn(),
        open: vi.fn(),
        goTo: vi.fn(() => pending),
        setNavigationState: vi.fn(),
        subscribe: vi.fn(() => () => undefined),
        destroy: vi.fn(),
      };
      const onState = vi.fn();
      const onBusy = vi.fn();
      const flush = vi.fn();
      const service = new ReaderNavigationService({
        engine,
        initialState: createReaderProgress([0, 1], undefined, relocation(0)),
        onState,
        onBusy,
        flush,
      });
      const navigation = service.navigate({ source: 'next' });
      service.dispose();
      const flushCount = flush.mock.calls.length;
      const footerCount = vi.mocked(engine.setNavigationState).mock.calls.length;
      service.relocate(relocation(1));
      release();
      expect(await navigation).toBe(false);
      expect(await service.navigate({ source: 'next' })).toBe(false);
      service.flush();
      service.dispose();
      expect(flush).toHaveBeenCalledTimes(flushCount);
      expect(engine.setNavigationState).toHaveBeenCalledTimes(footerCount);
      expect(onState).not.toHaveBeenCalled();
      expect(onBusy).toHaveBeenCalledExactlyOnceWith(true);
      expect(service.currentState.currentSpineIndex).toBe(0);
      expect(service.currentState.completedSpineIndices).toEqual([]);
    },
  );
});
