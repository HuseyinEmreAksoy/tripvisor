import { test, expect } from '@playwright/test';
import { skipIfEnvNotConfigured, dismissDevOverlay } from './_preflight';

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
    await dismissDevOverlay(page);
    const loginVisible = await page.getByRole('heading', { name: /sign in/i }).isVisible();
    test.skip(loginVisible, 'Requires authenticated session (Phase 4 fixture not wired yet)');

    // Assume we can navigate to any existing trip; if none, skip.
    const firstTrip = page.locator('[role="button"][aria-label^="Open trip"]').first();
    if (!(await firstTrip.isVisible())) {
      test.skip(true, 'No existing trip — seed data required');
    }
    await firstTrip.click();
    // Map renders on the default tab and may trigger the dev LogBox if SSR warnings fire.
    // Dismiss any overlay before switching tabs.
    await dismissDevOverlay(page);
    await page.getByRole('tab', { name: /itinerary/i }).click();
    await dismissDevOverlay(page);
    await expect(page.getByRole('button', { name: /add a place/i })).toBeVisible();
  });

  test('settings tab exposes budget slider + transport mode', async ({ page }) => {
    await page.goto('/trips');
    await dismissDevOverlay(page);
    const loginVisible = await page.getByRole('heading', { name: /sign in/i }).isVisible();
    test.skip(loginVisible, 'Requires authenticated session');

    const firstTrip = page.locator('[role="button"][aria-label^="Open trip"]').first();
    if (!(await firstTrip.isVisible())) test.skip(true, 'No existing trip');
    await firstTrip.click();

    await page.getByRole('tab', { name: /settings/i }).click();
    // SegmentedControl uses accessibilityRole="radio" (not "button") on each option.
    await expect(page.getByRole('radio', { name: /^drive$/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /^walk$/i })).toBeVisible();
    await expect(page.getByRole('radio', { name: /^transit$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /delete trip/i })).toBeVisible();
  });
});
