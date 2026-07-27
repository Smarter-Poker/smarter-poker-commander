import { defineConfig } from 'vitest/config';

/**
 * Added 2026-07-27 (audit hardening phase).
 *
 * Two things this fixes:
 *  1. `npm test` previously found no unit tests at all, so the CI "Test" step
 *     was decorative. It is now a real gate.
 *  2. Without an explicit include, vitest picks up tests/e2e/pin-gate.spec.ts
 *     and dies on its `@playwright/test` import. Playwright specs are run
 *     separately via `npm run test:e2e`, so they are excluded here.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.js'],
    exclude: ['node_modules/**', 'tests/e2e/**', '.next/**'],
    reporters: 'default',
  },
});
