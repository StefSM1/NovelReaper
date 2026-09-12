import { expect, test, type Page } from '@playwright/test';

import { createSyntheticEpub } from '../fixtures/synthetic-epub';

async function openFixture(page: Page): Promise<void> {
  const file = createSyntheticEpub();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open EPUB', exact: true }).click();
  await (
    await chooser
  ).setFiles({
    name: file.name,
    mimeType: file.type,
    buffer: Buffer.from(await file.arrayBuffer()),
  });
  await expect(
    page.frameLocator('.publication-reader-frame').getByRole('heading', {
      name: 'A Quiet Start',
    }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Table of contents' })).toHaveAttribute(
    'aria-busy',
    'false',
  );
}

test('real chapter navigation and Resume work on desktop and a phone-sized viewport', async ({
  page,
}) => {
  await page.goto('/');
  await openFixture(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const reader = page.frameLocator('.publication-reader-frame');
    await reader.getByRole('button', { name: 'Next Chapter >', exact: true }).click();
    await expect(reader.getByRole('heading', { name: 'The Second Page' })).toBeVisible();
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(reader.getByRole('heading', { name: 'The Second Page' })).toBeVisible();
    await reader.getByRole('button', { name: '< Previous Chapter', exact: true }).click();
    await expect(reader.getByRole('heading', { name: 'A Quiet Start' })).toBeVisible();
  }
});

test('abandoning an in-flight chapter cannot freeze Resume or report a stale error', async ({
  page,
}) => {
  await page.goto('/');
  await openFixture(page);
  await page.evaluate(() => {
    const fetch = window.fetch.bind(window);
    let intercepted = false;
    const control = window as unknown as { chapterStarted: boolean; releaseChapter: () => void };
    const gate = new Promise<void>((resolve) => {
      control.releaseChapter = resolve;
    });
    window.fetch = async (...args) => {
      const input = args[0];
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!intercepted && url.startsWith('blob:')) {
        intercepted = true;
        control.chapterStarted = true;
        await gate;
        throw new Error('Test: abandoned chapter load failed');
      }
      return fetch(...args);
    };
  });
  await page.getByRole('button', { name: /The Second Page/ }).click();
  await page.waitForFunction(
    () => (window as unknown as { chapterStarted: boolean }).chapterStarted,
  );
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  const reader = page.frameLocator('.publication-reader-frame');
  await expect(reader.getByRole('heading', { name: 'A Quiet Start' })).toBeVisible();
  await page.evaluate(() => (window as unknown as { releaseChapter: () => void }).releaseChapter());
  await page.getByRole('button', { name: /The Second Page/ }).click();
  await expect(reader.getByRole('heading', { name: 'The Second Page' })).toBeVisible();
  await expect(page.getByText('Chapter navigation failed.')).toHaveCount(0);
});

test('a failed real browser storage write keeps the library card and shows an error', async ({
  page,
}) => {
  await page.goto('/');
  await openFixture(page);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem.bind(window.localStorage);
    Storage.prototype.setItem = function (key, value) {
      if (key === 'novelreaper:browser-preview:v1')
        throw new DOMException('Full', 'QuotaExceededError');
      setItem(key, value);
    };
  });
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Remove card', exact: true }).click();
  await expect(page.getByText('That library card could not be removed.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Synthetic Reader Test' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Synthetic Reader Test' })).toBeVisible();
});
