import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'packages/**/sim/**/*.test.ts'],
    alias: { '@': new URL('./packages/web/src', import.meta.url).pathname },
    // Simulations replay thousands of rotations; they need room.
    testTimeout: 120_000,
  },
});
