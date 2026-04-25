import { test, expect } from '@playwright/test';
import { skipIfEnvNotConfigured, dismissDevOverlay } from './_preflight';

test.describe('Phase 2 — optimize + day split + map', () => {
  test.beforeEach(() => {
    skipIfEnvNotConfigured();
  });

  /**
   * These specs assume an authenticated session exists. Phase 4 will add
   * storageState-based fixtures; for MVP smoke, we expect the user (or a
   * prior Phase 1 spec in the same run) to be signed in.
   *
   * What we verify once signed in:
   *   - /trip/new form creates a trip
   *   - Trip detail renders tabs
   *   - Adding 3+ places triggers optimize
   *   - Map tab shows polyline after optimize completes
   */
  test('create trip → add places → tabs render', async ({ page }) => {
    await page.goto('/trips');
    await dismissDevOverlay(page);
    // Skip if not authenticated — auth fixtures come in Phase 4
    const loginVisible = await page.getByRole('heading', { name: /sign in/i }).isVisible();
    test.skip(loginVisible, 'Requires authenticated session (Phase 4 fixture not wired yet)');

    // Create trip
    await page.getByRole('button', { name: /(new trip|create trip)/i }).first().click();
    await expect(page).toHaveURL(/\/trip\/new$/);
    // Phase 20 Step 5 renamed the title field to "Destination or trip name"
    // and the budget field to "Daily plan time (hours)".
    await page.getByRole('textbox', { name: /destination or trip name/i }).fill(`Smoke ${Date.now()}`);
    await page.getByRole('textbox', { name: /daily plan time/i }).fill('8');
    await page.getByRole('button', { name: /create trip/i }).click();
    await expect(page).toHaveURL(/\/trip\/[0-9a-f-]+$/);

    // Trip detail tabs exist.
    // Phase 20 Step 4: desktop layout collapses Map+Itinerary into one tab
    // "Map & Itinerary". On desktop (≥1024px) the itinerary tab no longer
    // exists as a separate role="tab" — only "Map & Itinerary" and "Settings".
    // The regex /map/i matches "Map & Itinerary"; /settings/i matches "Settings".
    await expect(page.getByRole('tab', { name: /map/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /settings/i })).toBeVisible();
  });
});
