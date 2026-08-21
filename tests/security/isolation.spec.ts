import { expect, test } from '@playwright/test';

import { launchNovelReaper, type LaunchedNovelReaper } from '../helpers/electron-app';

test.describe('reader containment', () => {
  let running: LaunchedNovelReaper | undefined;

  test.beforeEach(async () => {
    running = await launchNovelReaper();
    await expect(running.page.getByText('Reader: ready')).toBeVisible();
  });

  test.afterEach(async () => {
    await running?.close();
  });

  test('uses separate sandboxed WebContents and a capability-limited bridge', async () => {
    if (!running) throw new Error('NovelReaper did not launch.');
    const diagnostics = await running.app.evaluate(() =>
      globalThis.__NOVELREAPER_TEST__?.diagnostics(),
    );
    expect(diagnostics?.reader).toBeDefined();
    expect(diagnostics?.reader?.id).not.toBe(diagnostics?.shell.id);
    expect(diagnostics?.reader?.osProcessId).toBeGreaterThan(0);
    expect(diagnostics?.reader?.osProcessId).not.toBe(diagnostics?.shell.osProcessId);
    expect(diagnostics?.reader?.isSessionPersistent).toBe(false);
    expect(diagnostics?.reader?.sessionStoragePath).toBeNull();

    for (const preferences of [
      diagnostics?.shell.webPreferences,
      diagnostics?.reader?.webPreferences,
    ]) {
      expect(preferences).toEqual({
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        webSecurity: true,
        webviewTag: false,
      });
    }

    const readerMainWorld = await running.app.evaluate(async ({ webContents }, id) => {
      const contents = webContents.fromId(id);
      if (!contents) throw new Error('Reader WebContents not found.');
      return contents.executeJavaScript(`({
        processType: typeof process,
        requireType: typeof require,
        bufferType: typeof Buffer,
        electronType: typeof electron,
        bridgeKeys: Object.keys(window.novelReaperReader).sort()
      })`);
    }, diagnostics?.reader?.id ?? -1);

    expect(readerMainWorld).toEqual({
      processType: 'undefined',
      requireType: 'undefined',
      bufferType: 'undefined',
      electronType: 'undefined',
      bridgeKeys: ['onCommand', 'report'],
    });
  });

  test('denies popup and unexpected navigation attempts', async () => {
    if (!running) throw new Error('NovelReaper did not launch.');
    const diagnostics = await running.app.evaluate(() =>
      globalThis.__NOVELREAPER_TEST__?.diagnostics(),
    );
    const readerId = diagnostics?.reader?.id ?? -1;
    const originalUrl = diagnostics?.reader?.url;

    const popupResult = await running.app.evaluate(async ({ webContents }, id) => {
      const before = webContents.getAllWebContents().length;
      const contents = webContents.fromId(id);
      if (!contents) throw new Error('Reader WebContents not found.');
      const returnedNull = await contents.executeJavaScript(
        `window.open('https://example.invalid') === null`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      return { returnedNull, before, after: webContents.getAllWebContents().length };
    }, readerId);

    expect(popupResult.returnedNull).toBe(true);
    expect(popupResult.after).toBe(popupResult.before);

    await running.app.evaluate(async ({ webContents }, id) => {
      const contents = webContents.fromId(id);
      if (!contents) throw new Error('Reader WebContents not found.');
      await contents.executeJavaScript(`location.assign('https://example.invalid')`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }, readerId);

    const afterNavigation = await running.app.evaluate(() =>
      globalThis.__NOVELREAPER_TEST__?.diagnostics(),
    );
    expect(afterNavigation?.reader?.url).toBe(originalUrl);
  });

  test('contains a forced reader crash and creates a fresh recovery generation', async () => {
    if (!running) throw new Error('NovelReaper did not launch.');
    const before = await running.app.evaluate(() =>
      globalThis.__NOVELREAPER_TEST__?.diagnostics(),
    );
    expect(before?.reader?.osProcessId).not.toBe(before?.shell.osProcessId);

    await running.app.evaluate(() => globalThis.__NOVELREAPER_TEST__?.crashReader());
    await expect(
      running.page.getByRole('button', { name: 'Restart reading surface' }),
    ).toBeVisible();
    await expect(running.page.getByTestId('titlebar')).toContainText('NovelReaper');

    await running.page.getByRole('button', { name: 'Restart reading surface' }).click();
    await expect(running.page.getByText('Reader: ready')).toBeVisible();

    const after = await running.app.evaluate(() =>
      globalThis.__NOVELREAPER_TEST__?.diagnostics(),
    );
    expect(after?.reader?.id).not.toBe(before?.reader?.id);
    expect(after?.reader?.osProcessId).not.toBe(before?.reader?.osProcessId);
    expect(after?.generation).toBeGreaterThan(before?.generation ?? 0);
  });
});
