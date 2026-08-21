import { expect, test } from '@playwright/test';

import { launchNovelReaper, type LaunchedNovelReaper } from '../helpers/electron-app';

test.describe('packaged NovelReaper shell', () => {
  let running: LaunchedNovelReaper | undefined;

  test.beforeEach(async () => {
    running = await launchNovelReaper();
  });

  test.afterEach(async () => {
    await running?.close();
  });

  test('starts the shell and isolated reader', async () => {
    if (!running) throw new Error('NovelReaper did not launch.');
    await expect(running.page.getByTestId('titlebar')).toContainText('NovelReaper');
    await expect(running.page.getByText('Reader: ready')).toBeVisible();

    const mainWorld = await running.page.evaluate(() => ({
      processType: typeof process,
      requireType: typeof require,
      bufferType: typeof Buffer,
      bridgeKeys: Object.keys(window.novelReaperShell).sort(),
    }));

    expect(mainWorld.processType).toBe('undefined');
    expect(mainWorld.requireType).toBe('undefined');
    expect(mainWorld.bufferType).toBe('undefined');
    expect(mainWorld.bridgeKeys).toEqual([
      'getBootstrapState',
      'onExitFocusRequested',
      'onReaderState',
      'onWindowState',
      'performWindowAction',
      'recoverReader',
      'setReaderBounds',
    ]);

    const diagnostics = await running.app.evaluate(() =>
      globalThis.__NOVELREAPER_TEST__?.diagnostics(),
    );
    expect(diagnostics?.status).toBe('ready');
    expect(diagnostics?.reader?.id).not.toBe(diagnostics?.shell.id);
    expect(diagnostics?.reader?.osProcessId).not.toBe(diagnostics?.shell.osProcessId);
    expect(diagnostics?.reader?.isSessionPersistent).toBe(false);
    expect(diagnostics?.reader?.sessionStoragePath).toBeNull();
  });
});
