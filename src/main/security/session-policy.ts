import type { Session } from 'electron';

const NETWORK_FILTER = {
  urls: [
    'http://*/*',
    'https://*/*',
    'ws://*/*',
    'wss://*/*',
    'ftp://*/*',
    'file://*/*',
  ],
};

function requestMatchesDevelopmentOrigin(requestUrl: URL, entryUrl: URL): boolean {
  if (requestUrl.origin === entryUrl.origin) return true;

  const isMatchingSocket =
    (requestUrl.protocol === 'ws:' || requestUrl.protocol === 'wss:') &&
    requestUrl.hostname === entryUrl.hostname &&
    requestUrl.port === entryUrl.port;

  return isMatchingSocket;
}

export function installSessionDenyPolicy(options: {
  session: Session;
  developmentEntryUrl?: string;
}): () => void {
  const { session, developmentEntryUrl } = options;
  const developmentEntry = developmentEntryUrl ? new URL(developmentEntryUrl) : undefined;

  session.setPermissionCheckHandler(() => false);
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  session.setUSBProtectedClassesHandler(() => []);
  session.setSpellCheckerEnabled(false);

  const onDownload = (event: Electron.Event): void => event.preventDefault();
  const onRestrictedFileSystem = (
    event: Electron.Event,
    _details: Electron.FileSystemAccessRestrictedDetails,
    callback: (action: 'allow' | 'deny' | 'tryAgain') => void,
  ): void => {
    event.preventDefault();
    callback('deny');
  };
  const onSelectHid = (
    event: Electron.Event,
    _details: Electron.SelectHidDeviceDetails,
    callback: (deviceId?: string | null) => void,
  ): void => {
    event.preventDefault();
    callback();
  };
  const onSelectSerial = (
    event: Electron.Event,
    _ports: Electron.SerialPort[],
    _webContents: Electron.WebContents,
    callback: (portId: string) => void,
  ): void => {
    event.preventDefault();
    callback('');
  };
  const onSelectUsb = (
    event: Electron.Event,
    _details: Electron.SelectUsbDeviceDetails,
    callback: (deviceId?: string) => void,
  ): void => {
    event.preventDefault();
    callback();
  };
  const onSelectWebAuthn = (
    event: Electron.Event,
    _details: Electron.SelectWebauthnAccountDetails,
    callback: (credentialId?: string | null) => void,
  ): void => {
    event.preventDefault();
    callback();
  };

  session.on('will-download', onDownload);
  session.on('file-system-access-restricted', onRestrictedFileSystem);
  session.on('select-hid-device', onSelectHid);
  session.on('select-serial-port', onSelectSerial);
  session.on('select-usb-device', onSelectUsb);
  session.on('select-webauthn-account', onSelectWebAuthn);

  session.webRequest.onBeforeRequest(NETWORK_FILTER, (details, callback) => {
    let allowed = false;
    if (developmentEntry) {
      try {
        allowed = requestMatchesDevelopmentOrigin(new URL(details.url), developmentEntry);
      } catch {
        allowed = false;
      }
    }
    callback({ cancel: !allowed });
  });

  return () => {
    session.webRequest.onBeforeRequest(null);
    session.setPermissionCheckHandler(null);
    session.setPermissionRequestHandler(null);
    session.setDevicePermissionHandler(null);
    session.setDisplayMediaRequestHandler(null);
    session.setUSBProtectedClassesHandler(null);
    session.removeListener('will-download', onDownload);
    session.removeListener('file-system-access-restricted', onRestrictedFileSystem);
    session.removeListener('select-hid-device', onSelectHid);
    session.removeListener('select-serial-port', onSelectSerial);
    session.removeListener('select-usb-device', onSelectUsb);
    session.removeListener('select-webauthn-account', onSelectWebAuthn);
  };
}
