import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';

import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

export interface LaunchedNovelReaper {
  app: ElectronApplication;
  page: Page;
  close: () => Promise<void>;
}

function packagedExecutable(): string {
  return resolve('out', 'NovelReaper-win32-x64', 'NovelReaper.exe');
}

function safeRemoveProfile(profilePath: string): void {
  const resolvedProfile = resolve(profilePath);
  const resolvedTemp = `${resolve(tmpdir())}${sep}`;
  if (!resolvedProfile.startsWith(resolvedTemp)) {
    throw new Error(`Refusing to remove non-temporary profile: ${resolvedProfile}`);
  }
  if (!basename(resolvedProfile).startsWith('novelreaper-e2e-')) {
    throw new Error(`Refusing to remove unexpected profile: ${resolvedProfile}`);
  }
  rmSync(resolvedProfile, { recursive: true, force: true });
}

export async function launchNovelReaper(): Promise<LaunchedNovelReaper> {
  const executablePath = packagedExecutable();
  if (!existsSync(executablePath)) {
    throw new Error(`Packaged application is missing at ${executablePath}. Run npm run package.`);
  }

  const profilePath = mkdtempSync(join(tmpdir(), 'novelreaper-e2e-'));
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => {
      return typeof entry[1] === 'string';
    }),
  );

  const app = await electron.launch({
    executablePath,
    args: ['--disable-gpu'],
    env: {
      ...environment,
      NOVELREAPER_E2E: '1',
      NOVELREAPER_USER_DATA: profilePath,
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  return {
    app,
    page,
    close: async () => {
      try {
        await app.close();
      } finally {
        safeRemoveProfile(profilePath);
      }
    },
  };
}
