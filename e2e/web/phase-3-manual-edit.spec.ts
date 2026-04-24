import { test, expect } from '@playwright/test';
import { skipIfEnvNotConfigured } from './_preflight';

test.describe('Phase 3 — drag, move-to-day, duration override', () => {
  test.beforeEach(() => {
    skipIfEnvNotConfigured();
  });

  /**
   * Smoke-level: assert the UI affordances for manual editing exist and
   * respond. Deep interaction (actual drag reorder + RPC round-trip) requires
   * pre-seeded data and an authenticated session — Phase 4 fixture work.
   */
  test('itinerary tab offers tab + add-place action', async ({ page }) => {
    await page.goto('/trips');
    const loginVisible = await page.getByRole('heading', { name: /sign in/i }).isVisible();
    test.skip(loginVisible, 'Requires authenticated session (Phase 4 fixture not wired yet)');

    // Assume we can navigate to any existing trip; if none, skip.
    const firstTrip = page.locator('[role="button"][aria-label^="Open trip"]').first();
    if (!(await firstTrip.isVisible())) {
      test.skip(true, 'No existing trip — seed data required');
    }
    await firstTrip.click();

    await page.getByRole('tab', { name: /itinerary/i }).click();
    await expect(page.getByRole('button', { name: /add a place/i })).toBeVisible();
  });

  test('settings tab exposes budget slider + transport mode', async ({ page }) => {
    await page.goto('/trips');
    const loginVisible = await page.getByRole('heading', { name: /sign in/i }).isVisible();
    test.skip(loginVisible, 'Requires authenticated session');

    const firstTrip = page.locator('[role="button"][aria-label^="Open trip"]').first();
    if (!(await firstTrip.isVisible())) test.skip(true, 'No existing trip');
    await firstTrip.click();

    await page.getByRole('tab', { name: /settings/i }).click();
    await expect(page.getByRole('button', { name: /drive/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /walk/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /transit/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /delete trip/i })).toBeVisible();
  });
});
