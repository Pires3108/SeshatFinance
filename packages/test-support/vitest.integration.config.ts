import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.integration.spec.ts'],
    maxWorkers: 1,
    testTimeout: 60_000,
  },
});
