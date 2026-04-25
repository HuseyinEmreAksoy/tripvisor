import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

/**
 * Playwright config for Tripvisor web smoke tests.
 *
 * - Targets the Expo web dev server at http://localhost:8081
 * - You're expected to `npm run web` in another shell before running, OR
 *   let Playwright start it via `webServer` (enabled below)
 * - Requires a live Supabase project + filled .env for the full golden path
 * - When env is not set, specs skip with a clear message instead of failing
 *
 * Auth & seeding:
 *   The `setup` project (Step 6.1) runs once before chromium specs. It signs
 *   in via admin generate_link, persists storage state to e2e/web/.auth/user.json,
 *   and seeds one fixture trip with two places. The chromium project consumes
 *   that storage state so phase-4-polish.spec.ts (and other auth-gated specs)
 *   start authenticated.
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
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      timeout: 90_000,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/web/.auth/user.json',
      },
      dependencies: ['setup'],
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
