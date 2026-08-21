import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/security',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 60_000,
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
