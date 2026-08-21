// @vitest-environment node

import type {
  IpcMainEvent,
  Session,
  WebContents,
  WebFrameMain,
} from 'electron';
import { describe, expect, it } from 'vitest';

import {
  authorizeTopFrameIpc,
  IpcAuthorizationError,
} from '../../../src/main/security/ipc-authorization';

function createFixture(): {
  event: IpcMainEvent;
  contents: WebContents;
  frame: WebFrameMain;
  session: Session;
} {
  const session = {} as Session;
  const frame = { origin: 'novelreaper-app://shell' } as WebFrameMain;
  const contents = {
    isDestroyed: () => false,
    mainFrame: frame,
    session,
  } as unknown as WebContents;
  const event = { sender: contents, senderFrame: frame } as IpcMainEvent;
  return { event, contents, frame, session };
}

describe('top-frame IPC authorization', () => {
  it('accepts the exact WebContents, Session, frame, and origin', () => {
    const fixture = createFixture();
    expect(() =>
      authorizeTopFrameIpc(
        fixture.event,
        fixture.contents,
        fixture.session,
        'novelreaper-app://shell',
      ),
    ).not.toThrow();
  });

  it.each(['sender', 'session', 'frame', 'origin', 'destroyed'] as const)(
    'rejects a mismatched %s',
    (mismatch) => {
      const fixture = createFixture();
      let event = fixture.event;
      let contents = fixture.contents;
      let session = fixture.session;
      let origin = 'novelreaper-app://shell';

      if (mismatch === 'sender') {
        event = { ...fixture.event, sender: {} as WebContents } as IpcMainEvent;
      }
      if (mismatch === 'session') session = {} as Session;
      if (mismatch === 'frame') {
        event = { ...fixture.event, senderFrame: {} as WebFrameMain } as IpcMainEvent;
      }
      if (mismatch === 'origin') origin = 'https://attacker.invalid';
      if (mismatch === 'destroyed') {
        contents = {
          ...fixture.contents,
          isDestroyed: () => true,
        } as WebContents;
        event = { ...fixture.event, sender: contents } as IpcMainEvent;
      }

      expect(() => authorizeTopFrameIpc(event, contents, session, origin)).toThrow(
        IpcAuthorizationError,
      );
    },
  );
});
