import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // One process: tests share nothing but must not fight over ports (we use port 0).
    pool: 'forks',
  },
});
