import type { IpcMainEvent, IpcMainInvokeEvent, Session, WebContents } from 'electron';

export class IpcAuthorizationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'IpcAuthorizationError';
  }
}

export function authorizeTopFrameIpc(
  event: IpcMainEvent | IpcMainInvokeEvent,
  expectedContents: WebContents,
  expectedSession: Session,
  expectedOrigin: string,
): void {
  if (expectedContents.isDestroyed() || event.sender !== expectedContents) {
    throw new IpcAuthorizationError('IPC sender is not the active WebContents.');
  }
  if (event.sender.session !== expectedSession) {
    throw new IpcAuthorizationError('IPC sender session does not match.');
  }

  const frame = event.senderFrame;
  if (!frame || frame !== expectedContents.mainFrame) {
    throw new IpcAuthorizationError('IPC is restricted to the active main frame.');
  }
  if (frame.origin !== expectedOrigin) {
    throw new IpcAuthorizationError('IPC sender origin does not match.');
  }
}
