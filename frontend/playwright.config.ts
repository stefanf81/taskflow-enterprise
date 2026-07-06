import { defineConfig, devices } from '@playwright/test';

/**
 * PLAYWRIGHT E2E CONFIGURATION
 *
 * Why this is used:
 * This configures Microsoft Playwright to execute end-to-end browser tests.
 * It includes a built-in 'webServer' block that automatically spins up your
 * Angular dev server (npm start) on port 4200 and waits for it to become healthy
 * before running the tests, completely automating the E2E lifecycle!
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://127.0.0.1:4200',
    trace: 'on',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Automatically spin up the Angular dev server during E2E testing */
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000, // 2 minutes timeout for slow startup
  },
});
