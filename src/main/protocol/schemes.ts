import { protocol } from 'electron';

export const SHELL_SCHEME = 'novelreaper-app';
export const READER_SCHEME = 'novelreaper-reader';

let schemesRegistered = false;

export function serializedOrigin(url: string): string {
  const parsed = new URL(url);
  return parsed.origin === 'null' ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
}

export function isSameDocumentNavigation(candidate: string, entry: string): boolean {
  try {
    const candidateUrl = new URL(candidate);
    const entryUrl = new URL(entry);
    return (
      candidateUrl.protocol === entryUrl.protocol &&
      candidateUrl.host === entryUrl.host &&
      candidateUrl.pathname === entryUrl.pathname &&
      candidateUrl.search === entryUrl.search
    );
  } catch {
    return false;
  }
}

export function registerPrivilegedSchemes(): void {
  if (schemesRegistered) return;
  schemesRegistered = true;

  protocol.registerSchemesAsPrivileged([
    {
      scheme: SHELL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
      },
    },
    {
      scheme: READER_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ]);
}
