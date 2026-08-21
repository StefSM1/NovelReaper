// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  mainToReaderCommandSchema,
  readerBoundsSchema,
  readerToMainEventSchema,
  windowActionSchema,
} from '../../../src/shared/contracts/ipc';

describe('strict IPC schemas', () => {
  it('accepts a bounded integer reader rectangle', () => {
    expect(readerBoundsSchema.parse({ x: 0, y: 48, width: 900, height: 700 })).toEqual({
      x: 0,
      y: 48,
      width: 900,
      height: 700,
    });
  });

  it.each([
    { x: -1, y: 0, width: 1, height: 1 },
    { x: 0.5, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 0, height: 1 },
    { x: 0, y: 0, width: Number.NaN, height: 1 },
    { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 1 },
    { x: 0, y: 0, width: 1, height: 1, arbitrary: true },
  ])('rejects unsafe reader bounds: %j', (payload) => {
    expect(readerBoundsSchema.safeParse(payload).success).toBe(false);
  });

  it('allows only named window actions', () => {
    expect(windowActionSchema.parse('toggle-fullscreen')).toBe('toggle-fullscreen');
    expect(windowActionSchema.safeParse('invoke-anything').success).toBe(false);
  });

  it('rejects malformed or extended reader events', () => {
    expect(
      readerToMainEventSchema.parse({ type: 'ready', protocolVersion: 1 }),
    ).toEqual({ type: 'ready', protocolVersion: 1 });
    expect(
      readerToMainEventSchema.safeParse({
        type: 'ready',
        protocolVersion: 1,
        sourcePath: 'C:\\private.epub',
      }).success,
    ).toBe(false);
    expect(readerToMainEventSchema.safeParse({ type: 'unknown' }).success).toBe(false);
  });

  it('bounds reader command values and rejects extra properties', () => {
    const nonce = '3b12f1df-5232-4804-897e-917bf397618a';
    expect(mainToReaderCommandSchema.parse({ type: 'ping', nonce })).toEqual({
      type: 'ping',
      nonce,
    });
    expect(
      mainToReaderCommandSchema.safeParse({ type: 'ping', nonce, channel: 'raw' }).success,
    ).toBe(false);
  });
});
