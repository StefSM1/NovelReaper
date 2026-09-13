import { expect, test, type Page } from '@playwright/test';

import { createSyntheticEpub, createSyntheticEpub2 } from '../fixtures/synthetic-epub';

async function importBook(page: Page, file: File, name = file.name, heading = 'A Quiet Start') {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open EPUB', exact: true }).click();
  await chooser;
  // Preserve the original file timestamp to exercise migration from B1-B6 records.
  await page.evaluate(
    ({ bytes, name, modified }) => {
      const input = document.querySelector<HTMLInputElement>('input[type="file"]');
      if (!input) throw new Error('File picker was not opened.');
      const files = new DataTransfer();
      files.items.add(
        new File([new Uint8Array(bytes)], name, {
          type: 'application/epub+zip',
          lastModified: modified,
        }),
      );
      input.files = files.files;
      input.dispatchEvent(new Event('change'));
    },
    { bytes: [...new Uint8Array(await file.arrayBuffer())], name, modified: file.lastModified },
  );
  await expect(
    page.frameLocator('.publication-reader-frame').getByRole('heading', { name: heading }),
  ).toBeVisible();
}

async function savedBookCount(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const request = indexedDB.open('novelreaper-library', 1);
        request.onerror = () => reject(request.error ?? new Error('Database open failed'));
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('files', 'readonly');
          const count = tx.objectStore('files').count();
          tx.oncomplete = () => {
            db.close();
            resolve(count.result);
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error ?? new Error('Database transaction failed'));
          };
        };
      }),
  );
}

async function localLibrarySnapshot(page: Page) {
  return page.evaluate(async () => {
    const records = await new Promise<{
      books: Array<{ id: string; title: string; customTitle?: string; contentHash: string }>;
      files: Blob[];
    }>((resolve, reject) => {
      const request = indexedDB.open('novelreaper-library', 1);
      request.onerror = () => reject(request.error ?? new Error('Database open failed'));
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['books', 'files'], 'readonly');
        const books = tx.objectStore('books').getAll();
        const files = tx.objectStore('files').getAll();
        tx.oncomplete = () => {
          db.close();
          resolve({ books: books.result, files: files.result });
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error('Database transaction failed'));
        };
      };
    });
    return {
      books: records.books,
      hashes: await Promise.all(
        records.files.map(async (file) => [
          ...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
        ]),
      ),
      progress: Object.fromEntries(
        Object.entries(localStorage).filter(([key]) =>
          key.startsWith('novelreaper:browser-progress:'),
        ),
      ),
    };
  });
}

test('custom volume titles persist without changing either EPUB or its progress', async ({
  page,
}) => {
  const file = createSyntheticEpub();
  await page.goto('/');
  await importBook(page, file);
  await page
    .frameLocator('.publication-reader-frame')
    .getByRole('button', { name: 'Next Chapter >' })
    .click();
  await expect(
    page
      .frameLocator('.publication-reader-frame')
      .getByRole('heading', { name: 'The Second Page' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await importBook(page, createSyntheticEpub({ longChapter: true }), 'Volume2.epub');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Synthetic Reader Test', exact: true }),
  ).toHaveCount(2);
  const before = await localLibrarySnapshot(page);
  const card = page.locator('.library-book').filter({ hasText: 'Last read: section 2' });
  await card.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Volume name' }).fill('  My Volume 1  ');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Volume 1', exact: true })).toBeVisible();
  const after = await localLibrarySnapshot(page);
  expect(after.progress).toEqual(before.progress);
  expect(after.hashes).toEqual(before.hashes);
  expect(after.books.map((book) => ({ ...book, customTitle: undefined }))).toEqual(
    before.books.map((book) => ({ ...book, customTitle: undefined })),
  );
  expect(after.books.filter((book) => book.customTitle)).toHaveLength(1);
  await card.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Current publication' })
      .getByRole('heading', { name: 'My Volume 1' }),
  ).toBeVisible();
  await expect(
    page
      .frameLocator('.publication-reader-frame')
      .getByRole('heading', { name: 'The Second Page' }),
  ).toBeVisible();
  await page.reload();
  const renamed = page
    .locator('.library-book')
    .filter({ has: page.getByRole('heading', { name: 'My Volume 1', exact: true }) });
  await renamed.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Current publication' })
      .getByRole('heading', { name: 'My Volume 1' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await importBook(page, file, 'Renamed-file.epub', 'The Second Page');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.locator('.library-book')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'My Volume 1', exact: true })).toBeVisible();
});

test('the rename editor fits light desktop and dark phone layouts', async ({ page }, testInfo) => {
  await page.goto('/');
  await importBook(page, createSyntheticEpub());
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Volume name' }).fill('Volume 2 — A New Beginning');
  await page.screenshot({ path: testInfo.outputPath('rename-light-desktop.png') });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Volume name' }).fill('Volume 2 — A New Beginning');
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeInViewport();
  expect(
    await page
      .locator('.library-screen')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('rename-dark-phone.png') });
  await page.getByRole('textbox', { name: 'Volume name' }).fill('<Volume & 2>');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: '<Volume & 2>', exact: true })).toBeVisible();
});

test('a failed title save keeps the old name and retryable draft', async ({ page }) => {
  await page.goto('/');
  await importBook(page, createSyntheticEpub());
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Restore the native method after one simulated storage failure.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'books') {
        IDBObjectStore.prototype.put = put;
        throw new DOMException('Storage full', 'QuotaExceededError');
      }
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Volume name' }).fill('Volume 7');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('previous title is unchanged');
  await expect(
    page.getByRole('heading', { name: 'Synthetic Reader Test', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Volume name' })).toHaveValue('Volume 7');
  expect((await localLibrarySnapshot(page)).books[0]?.customTitle).toBeUndefined();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Volume 7', exact: true })).toBeVisible();
});

test('a stored volume resumes after reload and a new tab without a file picker', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await importBook(page, createSyntheticEpub());
  await page
    .frameLocator('.publication-reader-frame')
    .getByRole('button', { name: 'Next Chapter >' })
    .click();
  await expect(
    page
      .frameLocator('.publication-reader-frame')
      .getByRole('heading', { name: 'The Second Page' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText('Saved on this device', { exact: true })).toBeVisible();
  await expect(page.getByText(/Last read: section 2/)).toBeVisible();
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('http://127.0.0.1:4177');
  const chooser = { opened: false };
  reopened.on('filechooser', () => {
    chooser.opened = true;
  });
  await reopened.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(
    reopened
      .frameLocator('.publication-reader-frame')
      .getByRole('heading', { name: 'The Second Page' }),
  ).toBeVisible();
  expect(chooser.opened).toBe(false);
});

test('renaming a duplicate keeps one copy and removing/reimporting preserves progress', async ({
  page,
}) => {
  const file = createSyntheticEpub();
  await page.goto('/');
  await importBook(page, file);
  await page
    .frameLocator('.publication-reader-frame')
    .getByRole('button', { name: 'Next Chapter >' })
    .click();
  await expect(
    page
      .frameLocator('.publication-reader-frame')
      .getByRole('heading', { name: 'The Second Page' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await importBook(page, file, 'Renamed.epub', 'The Second Page');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.locator('.library-book')).toHaveCount(1);
  expect(await savedBookCount(page)).toBe(1);
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Remove copy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No volumes yet' })).toBeVisible();
  expect(await savedBookCount(page)).toBe(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No volumes yet' })).toBeVisible();
  await importBook(page, file, 'Another name.epub', 'The Second Page');
});

test('different EPUB contents with the same filename remain separate volumes', async ({ page }) => {
  await page.goto('/');
  await importBook(page, createSyntheticEpub(), 'Volume.epub');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await importBook(page, createSyntheticEpub2(), 'Volume.epub', 'EPUB Two Opening');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.locator('.library-book')).toHaveCount(2);
  expect(await savedBookCount(page)).toBe(2);
});

test('legacy metadata and exact-file progress migrate without losing the old save', async ({
  page,
}) => {
  const file = createSyntheticEpub();
  const legacyKey = `novelreaper:browser-progress:v1:${encodeURIComponent(file.name)}:${file.size}:${file.lastModified}`;
  await page.goto('/');
  await page.evaluate(
    ({ fileName, size, modified, key }) => {
      localStorage.setItem(
        'novelreaper:browser-preview:v1',
        JSON.stringify({
          schemaVersion: 2,
          publications: [
            {
              id: 'f4cc55dc-c548-4780-b384-0c663bfdb14f',
              displayName: fileName,
              fileSize: size,
              lastModified: modified,
              mimeType: 'application/epub+zip',
              availability: 'reselect-required',
              title: 'Old library volume',
            },
          ],
        }),
      );
      localStorage.setItem(
        key,
        JSON.stringify({
          schemaVersion: 1,
          currentSpineIndex: 1,
          completedSpineIndices: [0],
          positions: { '1': { spineIndex: 1, href: 'chapter-2.xhtml', fractionInChapter: 0.3 } },
          finished: false,
          updatedAt: 100,
        }),
      );
      // A fresh database models upgrading an existing B1-B6 user, not an empty first visit.
      return new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase('novelreaper-library');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error ?? new Error('Database deletion failed'));
      });
    },
    { fileName: file.name, size: file.size, modified: file.lastModified, key: legacyKey },
  );
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Old library volume' })).toBeVisible();
  await importBook(page, file, file.name, 'The Second Page');
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.locator('.library-book')).toHaveCount(1);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toContain(legacyKey);
  expect(keys.some((key) => key.startsWith('novelreaper:browser-progress:sha256:'))).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(
    page
      .frameLocator('.publication-reader-frame')
      .getByRole('heading', { name: 'The Second Page' }),
  ).toBeVisible();
});

test('an aborted import leaves no saved file or false saved card', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No volumes yet' })).toBeVisible();
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Preserve the native receiver for the injected failure.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'books') throw new DOMException('Storage full', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await importBook(page, createSyntheticEpub());
  await expect(page.getByText(/The EPUB could not be saved on this device/)).toBeVisible();
  expect(await savedBookCount(page)).toBe(0);
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await expect(page.getByText('This session only', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'No volumes yet' })).toBeVisible();
});

test('a missing saved copy offers reselection while preserving progress', async ({ page }) => {
  const file = createSyntheticEpub();
  await page.goto('/');
  await importBook(page, file);
  await page
    .frameLocator('.publication-reader-frame')
    .getByRole('button', { name: 'Next Chapter >' })
    .click();
  await expect(
    page
      .frameLocator('.publication-reader-frame')
      .getByRole('heading', { name: 'The Second Page' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('novelreaper-library', 1);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('files', 'readwrite');
          tx.objectStore('files').clear();
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onabort = () => {
            db.close();
            reject(tx.error ?? new Error('Database transaction failed'));
          };
        };
        request.onerror = () => reject(request.error ?? new Error('Database open failed'));
      }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByText(/The saved EPUB is missing/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select again' })).toBeVisible();
  await importBook(page, file, file.name, 'The Second Page');
});

test('a failed reimport still restores existing fingerprint progress', async ({ page }) => {
  const file = createSyntheticEpub();
  await page.goto('/');
  await importBook(page, file);
  await page
    .frameLocator('.publication-reader-frame')
    .getByRole('button', { name: 'Next Chapter >' })
    .click();
  await expect(
    page
      .frameLocator('.publication-reader-frame')
      .getByRole('heading', { name: 'The Second Page' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Preserve the native receiver for the injected failure.
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'books') throw new DOMException('Full', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await importBook(page, file, 'Renamed retry.epub', 'The Second Page');
  await expect(page.getByText(/The EPUB could not be saved on this device/)).toBeVisible();
  await page.reload();
  expect(await savedBookCount(page)).toBe(1);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(
    page
      .frameLocator('.publication-reader-frame')
      .getByRole('heading', { name: 'The Second Page' }),
  ).toBeVisible();
});

test('a long chapter resumes its saved scroll position after reload', async ({ page }) => {
  await page.goto('/');
  await importBook(page, createSyntheticEpub({ longChapter: true }));
  const body = page.frameLocator('.publication-reader-frame').locator('body');
  await body.evaluate((element) => {
    const doc = element.ownerDocument;
    const root = doc.scrollingElement!;
    doc.defaultView!.scrollTo({
      top: (root.scrollHeight - root.clientHeight) * 0.4,
      behavior: 'instant',
    });
  });
  await page.waitForFunction(() =>
    Object.keys(localStorage).some((key) => {
      if (!key.startsWith('novelreaper:browser-progress:sha256:')) return false;
      const progress = JSON.parse(localStorage.getItem(key)!) as {
        positions: Record<string, { fractionInChapter: number }>;
      };
      const fraction = progress.positions['0']?.fractionInChapter ?? 0;
      return fraction > 0.3 && fraction < 0.5;
    }),
  );
  await page.reload();
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect
    .poll(() =>
      body.evaluate((element) => {
        const root = element.ownerDocument.scrollingElement!;
        return root.scrollTop / Math.max(1, root.scrollHeight - root.clientHeight);
      }),
    )
    .toBeGreaterThan(0.3);
  const fraction = await body.evaluate((element) => {
    const root = element.ownerDocument.scrollingElement!;
    return root.scrollTop / Math.max(1, root.scrollHeight - root.clientHeight);
  });
  expect(fraction).toBeLessThan(0.5);
});

test('the local copy and progress survive a full browser restart', async ({
  playwright,
}, testInfo) => {
  const profile = testInfo.outputPath('local-browser-profile');
  const options = {
    headless: true,
    viewport: { width: 1440, height: 960 },
    ...(process.env.NOVELREAPER_TEST_BROWSER_CHANNEL
      ? { channel: process.env.NOVELREAPER_TEST_BROWSER_CHANNEL }
      : {}),
  };
  const first = await playwright.chromium.launchPersistentContext(profile, options);
  try {
    const page = await first.newPage();
    await page.goto('http://127.0.0.1:4177');
    await importBook(page, createSyntheticEpub());
    await page
      .frameLocator('.publication-reader-frame')
      .getByRole('button', { name: 'Next Chapter >' })
      .click();
    await expect(
      page
        .frameLocator('.publication-reader-frame')
        .getByRole('heading', { name: 'The Second Page' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Library', exact: true }).click();
    await expect(page.getByText(/Last read: section 2/)).toBeVisible();
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByRole('textbox', { name: 'Volume name' }).fill('Restart-safe volume');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Restart-safe volume' })).toBeVisible();
  } finally {
    await first.close();
  }
  const second = await playwright.chromium.launchPersistentContext(profile, options);
  try {
    const page = await second.newPage();
    await page.goto('http://127.0.0.1:4177');
    await expect(page.getByRole('heading', { name: 'Restart-safe volume' })).toBeVisible();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'Current publication' })
        .getByRole('heading', { name: 'Restart-safe volume' }),
    ).toBeVisible();
    await expect(
      page
        .frameLocator('.publication-reader-frame')
        .getByRole('heading', { name: 'The Second Page' }),
    ).toBeVisible();
  } finally {
    await second.close();
  }
});
