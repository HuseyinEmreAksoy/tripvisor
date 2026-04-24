import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for Tripvisor web smoke tests.
 *
 * - Targets the Expo web dev server at http://localhost:8081
 * - You're expected to `npm run web` in another shell before running, OR
 *   let Playwright start it via `webServer` (enabled below)
 * - Requires a live Supabase project + filled .env for the full golden path
 * - When env is not set, specs skip with a clear message instead of failing
 */
export default defineConfig({
  testDir: './e2e/web',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://localhost:8081',
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
  webServer: {
    command: 'npm run web',
    url: 'http://localhost:8081',
    reuseExistingServer: true,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
