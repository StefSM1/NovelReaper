import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  timeout: 30_000,
  globalSetup: './tests/browser/server-setup.mts',
  use: {
    baseURL: 'http://127.0.0.1:4177',
    browserName: 'chromium',
    ...(process.env.NOVELREAPER_TEST_BROWSER_CHANNEL
      ? { channel: process.env.NOVELREAPER_TEST_BROWSER_CHANNEL }
      : {}),
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
  },
});
