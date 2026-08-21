import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    clearMocks: true,
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts', 'tests/component/**/*.test.tsx'],
    restoreMocks: true,
    setupFiles: ['./tests/setup.ts'],
  },
});
