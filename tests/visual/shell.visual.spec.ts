import { expect, test } from '@playwright/test';

import { launchNovelReaper, type LaunchedNovelReaper } from '../helpers/electron-app';

test.describe('Phase 1 visual foundation', () => {
  let running: LaunchedNovelReaper;

  test.beforeEach(async () => {
    running = await launchNovelReaper();
  });

  test.afterEach(async () => {
    await running.close();
  });

  test('keeps the three reading zones distinct at the minimum supported size', async () => {
    await running.page.setViewportSize({ width: 1200, height: 720 });
    const colors = await running.page.evaluate(() => {
      const contents = document.querySelector('.shell-panel--contents');
      const reader = document.querySelector('.reader-column');
      const appearance = document.querySelector('.shell-panel--appearance');
      if (!contents || !reader || !appearance) throw new Error('Reader zones missing.');
      return [contents, reader, appearance].map(
        (element) => getComputedStyle(element).backgroundColor,
      );
    });

    expect(new Set(colors).size).toBe(3);
    await expect(running.page.getByTestId('titlebar')).toBeVisible();
    await expect(running.page.getByTestId('reader-frame')).toBeVisible();
  });
});
