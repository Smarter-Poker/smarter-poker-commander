/**
 * Playwright Configuration — Commander
 * Phase 3.2 scaffold completion (2026-04-27)
 *
 * Specs live in `tests/e2e/`. The PIN-gate flow is the priority spec —
 * everything else routes through it. Run locally against `npm run dev`
 * (port 3001), CI runs against `commander.smarter.poker` preview deploys.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = 3001;
const LOCAL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || LOCAL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Local dev server boot — only when running locally, not in CI.
  webServer: process.env.CI
    ? undefined
    : {
        command: `npm run dev`,
        port: PORT,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
