import { expect, test, type Page } from '@playwright/test';
import axe from 'axe-core';
import { createSyntheticEpub } from '../fixtures/synthetic-epub';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openBook(page: Page, extraChapters = 0) {
  await page.goto('/');
  const file = createSyntheticEpub({ longChapter: true, extraChapters });
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
    page.frameLocator('.publication-reader-frame').getByRole('heading', { name: 'A Quiet Start' }),
  ).toBeVisible();
  await expect(page.locator('.reader-engine-overlay')).toHaveCount(0);
}

async function scrollPosition(page: Page) {
  return page
    .frameLocator('.publication-reader-frame')
    .locator('html')
    .evaluate((element) => ({
      top: element.scrollTop,
      height: element.clientHeight,
      width: element.clientWidth,
    }));
}

test('mobile overlays leave text visible, preserve position, and show live appearance changes', async ({
  page,
}, testInfo) => {
  await openBook(page);
  const frame = page.locator('.publication-reader-frame');
  const reader = page.frameLocator('.publication-reader-frame');
  const originalFrame = await frame.elementHandle();
  await reader
    .locator('html')
    .evaluate((element) =>
      window.scrollTo({ top: (element.scrollHeight - innerHeight) * 0.3, behavior: 'instant' }),
    );
  await expect.poll(async () => (await scrollPosition(page)).top).toBeGreaterThan(500);
  const before = await scrollPosition(page);
  await expect(page.locator('.titlebar')).not.toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('mobile-reading-light.png'),
    animations: 'disabled',
  });

  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  const chapters = page.getByRole('dialog', { name: 'Chapters', exact: true });
  await expect(chapters).toBeVisible();
  const bounds = await chapters.boundingBox();
  expect(bounds!.width).toBeLessThan(390 * 0.85);
  await expect(frame).toBeVisible();
  expect(await scrollPosition(page)).toEqual(before);
  await page.screenshot({
    path: testInfo.outputPath('mobile-chapters-light.png'),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await expect(chapters).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Contents', exact: true })).toBeFocused();

  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Appearance', exact: true });
  await expect(settings).toBeVisible();
  const sheet = await settings.boundingBox();
  expect(sheet!.height).toBeLessThan(844 / 2);
  expect(sheet!.y).toBeGreaterThan(844 / 2);
  expect(await scrollPosition(page)).toEqual(before);
  await settings.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'dark');
  await expect(reader.locator('body')).toHaveCSS('background-color', 'rgb(44, 48, 46)');
  await expect(settings.getByRole('button', { name: 'Increase font size' })).toBeEnabled();
  await settings.getByRole('button', { name: 'Increase font size' }).click();
  await expect(reader.locator('body')).toHaveCSS('font-size', '21px');
  await expect(settings.getByRole('button', { name: 'Increase font size' })).toBeEnabled();
  await settings.getByRole('combobox', { name: 'Font' }).selectOption('lora');
  await expect(reader.locator('body')).toHaveCSS('font-family', /Lora/);
  await expect(settings.getByRole('button', { name: 'Dark', exact: true })).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath('mobile-appearance-dark.png'),
    animations: 'disabled',
  });
  expect(await frame.evaluate((element, previous) => element === previous, originalFrame)).toBe(
    true,
  );
  await settings.getByRole('button', { name: 'Relaxed line spacing' }).click();
  await expect(reader.locator('body')).toHaveCSS('line-height', '37.8px');
  await settings.getByRole('button', { name: 'Balanced', exact: true }).scrollIntoViewIfNeeded();
  await expect(settings.getByRole('button', { name: 'Balanced', exact: true })).toBeInViewport();
  // Tapping uncovered text dismisses the popup; it cannot activate the reader behind it.
  await page.mouse.click(370, 100);
  await expect(settings).not.toBeVisible();
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await chapters.getByRole('button', { name: /The Second Page/ }).click();
  await expect(chapters).not.toBeVisible();
  await expect(reader.getByRole('heading', { name: 'The Second Page' })).toBeVisible();
});

test('compact dialogs work at small and landscape widths and restore desktop layout', async ({
  page,
}) => {
  await openBook(page);
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 844, height: 390 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    const popup = page.getByRole('dialog', { name: 'Appearance', exact: true });
    await expect(popup).toBeVisible();
    expect(await popup.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    expect((await popup.boundingBox())!.height).toBeLessThan(viewport.height * 0.5);
    await popup.getByRole('button', { name: 'Balanced', exact: true }).scrollIntoViewIfNeeded();
    await expect(popup.getByRole('button', { name: 'Balanced', exact: true })).toBeInViewport();
    await page.keyboard.press('Escape');
  }
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: 'Contents preview' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Appearance' })).toBeVisible();
  await expect(page.locator('.titlebar')).toBeVisible();
  await expect(page.locator('.publication-reader-frame')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Contents', exact: true })).toBeVisible();
});

test('chapter drawer virtualizes a large contents list and returns to the active chapter', async ({
  page,
}) => {
  await openBook(page, 600);
  const open = () => page.getByRole('button', { name: 'Contents', exact: true }).click();
  await open();
  const viewport = page.locator('.toc__viewport');
  await viewport.evaluate((element) => {
    element.scrollTop = 440 * 44;
  });
  const chapter = page.getByRole('button', { name: /442 Chapter 442/ });
  await expect(chapter).toBeVisible();
  expect(await page.locator('.toc__item').count()).toBeLessThan(50);
  await chapter.click();
  await expect(
    page.frameLocator('.publication-reader-frame').getByRole('heading', { name: 'Chapter 442' }),
  ).toBeVisible();
  await open();
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page.getByRole('button', { name: /1 A Quiet Start/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close chapters' }).click();
  await open();
  await expect(chapter).toBeVisible();
});

test('mobile dialogs keep focus inside and pass automated accessibility checks', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openBook(page);
  await page.evaluate(axe.source);
  for (const name of ['Contents', 'Appearance']) {
    await page.getByRole('button', { name, exact: true }).click();
    const dialog = page.getByRole('dialog');
    for (let index = 0; index < 8; index++) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    expect(
      await dialog.evaluate((element) => parseFloat(getComputedStyle(element).animationDuration)),
    ).toBeLessThan(0.01);
    const violations = await page.evaluate(async () => {
      const checker = (window as unknown as { axe: typeof axe }).axe;
      return (
        await checker.run(document.querySelector('dialog[open]')!, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
        })
      ).violations.map((issue) => ({
        id: issue.id,
        nodes: issue.nodes.map((node) => node.target),
      }));
    });
    expect(violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name, exact: true })).toBeFocused();
  }
});

test('a failed chapter selection stays visible in the drawer and can be retried', async ({
  page,
}) => {
  await openBook(page);
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    let failOnce = true;
    window.fetch = (...args) => {
      const input = args[0];
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (failOnce && url.startsWith('blob:')) {
        failOnce = false;
        return Promise.reject(new Error('Simulated chapter failure'));
      }
      return original(...args);
    };
  });
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Chapters' });
  await drawer.getByRole('button', { name: /The Second Page/ }).click();
  await expect(drawer.getByRole('alert')).toContainText('could not be opened');
  await expect(page.locator('.publication-reader-frame')).toBeVisible();
  await drawer.getByRole('button', { name: /The Second Page/ }).click();
  await expect(drawer).not.toBeVisible();
  await expect(
    page
      .frameLocator('.publication-reader-frame')
      .getByRole('heading', { name: 'The Second Page' }),
  ).toBeVisible();
});

test('mobile controls stay available with a saved desktop focus preference and on reload', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() =>
    localStorage.setItem(
      'novelreaper:browser-settings:v1',
      JSON.stringify({
        schemaVersion: 1,
        mode: 'focus',
        safetyLevel: 'strict',
        appearance: {
          theme: 'light',
          fontFamily: 'literata',
          fontSizePx: 20,
          lineHeight: 1.6,
          pageWidthCh: 68,
        },
      }),
    ),
  );
  await openBook(page);
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /The Second Page/ })
    .click();
  await expect(
    page
      .frameLocator('.publication-reader-frame')
      .getByRole('heading', { name: 'The Second Page' }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(
    page
      .frameLocator('.publication-reader-frame')
      .getByRole('heading', { name: 'The Second Page' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect(page.getByRole('button', { name: 'Exit focus', exact: true })).toBeVisible();
});
