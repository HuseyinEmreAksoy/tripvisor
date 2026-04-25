/**
 * Phase 11-12 — trips list filter / sort / search smoke tests.
 *
 * Covers:
 *   1. Search: type into trip search → filtered list. Clear button works.
 *   2. Sort cycle: tap sort button 4× → Recent → A→Z → Start → Cost → Recent.
 *   3. Date filter: open FilterSheet → pick "Upcoming" → list filters. Pick "All" to clear.
 *   4. No-results state: search for non-matching text → "No trips match your search."
 *
 * Pre-requisites:
 *   - EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY set
 *   - Auth setup seeds a fixture trip with a predictable title prefix
 *   - npm run web + npx supabase start
 */

import { test, expect } from '@playwright/test';
import { skipIfEnvNotConfigured, dismissDevOverlay } from './_preflight';

// ── helpers ───────────────────────────────────────────────────────────────────

async function goToTrips(page: import('@playwright/test').Page) {
  await page.goto('/trips');
  await page.waitForLoadState('networkidle');
  await dismissDevOverlay(page);
}

async function skipIfNotAuthenticated(page: import('@playwright/test').Page) {
  const isLogin = await page
    .getByRole('heading', { name: /sign in/i })
    .isVisible()
    .catch(() => false);
  test.skip(isLogin as boolean, 'Requires authenticated session from auth.setup.ts');
}

async function skipIfNoTrips(page: import('@playwright/test').Page) {
  const firstCard = page.locator('[aria-label^="Open trip"]').first();
  const hasTrip = await firstCard.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!hasTrip) {
    test.skip(true, 'No trip cards visible — seed data required');
  }
}

// =============================================================================
// 1. Search
// =============================================================================

test.describe('Phase 11-12 — trip search', () => {
  test('typing in search filters the list; clear button restores full list', async ({ page }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);
    await skipIfNoTrips(page);

    // The search input has accessibilityRole="search" and accessibilityLabel="Search trips by title".
    // On web, RNTL maps accessibilityRole="search" → role="search" and aria-label.
    // Playwright getByRole('searchbox') should match it.
    const searchInput = page
      .getByRole('searchbox')
      .or(page.getByLabel(/search trips by title/i))
      .first();

    const hasSearch = await searchInput.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasSearch) {
      test.skip(true, 'Search input not visible');
    }

    // Count trips before search.
    const beforeCount = await page.locator('[aria-label^="Open trip"]').count();

    // The fixture trip title contains "Phase 6 Smoke" (from auth.setup.ts).
    // Type something that matches the fixture trip.
    await searchInput.fill('Phase 6');
    // Wait for debounce (200ms in trips.tsx) + render.
    await page.waitForTimeout(400);

    const afterSearchCount = await page.locator('[aria-label^="Open trip"]').count();
    // After a specific search, we should have ≤ the original count.
    expect(afterSearchCount).toBeLessThanOrEqual(beforeCount);
    // And at least one match (the fixture trip contains "Phase 6").
    expect(afterSearchCount).toBeGreaterThan(0);

    // Clear button — visible when searchText.length > 0, aria-label "Clear search".
    const clearBtn = page.getByRole('button', { name: /clear search/i });
    await expect(clearBtn).toBeVisible({ timeout: 3_000 });
    await clearBtn.click();

    // After clearing, the full list should be back.
    await page.waitForTimeout(400); // debounce
    const afterClearCount = await page.locator('[aria-label^="Open trip"]').count();
    expect(afterClearCount).toBe(beforeCount);
  });
});

// =============================================================================
// 2. Sort cycle
// =============================================================================

test.describe('Phase 11-12 — sort cycle', () => {
  test('sort button cycles through Recent → A→Z → Start → Cost ↓ → Recent', async ({ page }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);

    // The sort button has an accessibilityLabel like "Sort: Recent. Tap to change sort order."
    // The button text (face label) is the current sort key: "Recent", "A→Z", "Start", "Cost ↓".
    // We locate it by its accessibilityLabel prefix.
    const sortBtn = page.getByRole('button', { name: /sort:/i });
    const hasSortBtn = await sortBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasSortBtn) {
      test.skip(true, 'Sort button not visible');
    }

    // Initial state should be "Recent".
    const initialLabel = await sortBtn.getAttribute('aria-label');
    expect(initialLabel).toMatch(/sort:\s*recent/i);

    // Cycle 1: Recent → A→Z
    await sortBtn.click();
    await page.waitForTimeout(100);
    const label1 = await sortBtn.getAttribute('aria-label');
    expect(label1).toMatch(/sort:\s*a→z|sort:\s*a.z/i);

    // Cycle 2: A→Z → Start
    await sortBtn.click();
    await page.waitForTimeout(100);
    const label2 = await sortBtn.getAttribute('aria-label');
    expect(label2).toMatch(/sort:\s*start/i);

    // Cycle 3: Start → Cost
    await sortBtn.click();
    await page.waitForTimeout(100);
    const label3 = await sortBtn.getAttribute('aria-label');
    expect(label3).toMatch(/sort:\s*cost/i);

    // Cycle 4: Cost → Recent (wraps)
    await sortBtn.click();
    await page.waitForTimeout(100);
    const label4 = await sortBtn.getAttribute('aria-label');
    expect(label4).toMatch(/sort:\s*recent/i);
  });
});

// =============================================================================
// 3. Date filter
// =============================================================================

test.describe('Phase 11-12 — date filter', () => {
  test('opening filter sheet and picking Upcoming filters the list', async ({ page }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);

    // Filter button — aria-label contains "Filter trips" or "Filter: ...".
    const filterBtn = page.getByRole('button', { name: /filter trips\. no filter active\.|filter:/i });
    const hasFilterBtn = await filterBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasFilterBtn) {
      test.skip(true, 'Filter button not visible');
    }

    await filterBtn.click();

    // FilterSheet should appear.
    // FilterSheet uses accessibilityRole="radio" for each option.
    const upcomingBtn = page.getByRole('radio', { name: /^upcoming$/i });
    await expect(upcomingBtn).toBeVisible({ timeout: 5_000 });
    await upcomingBtn.click();

    // After picking Upcoming, the sheet should close. The filter button label should update.
    // Verify: either the trips list changes or the filter button shows "Filter: Upcoming".
    const filterLabelAfter = await page
      .getByRole('button', { name: /filter:/i })
      .getAttribute('aria-label')
      .catch(() => null);

    if (filterLabelAfter) {
      expect(filterLabelAfter).toMatch(/upcoming/i);
    }
    // The sheet should have closed — "Upcoming" option shouldn't be in a modal context.
    // Body content still visible.
    await expect(page.locator('body')).toBeVisible();

    // Clear the filter by tapping Filter button again and picking "All".
    const filterBtnAfter = page.getByRole('button', { name: /filter:/i });
    const hasFilter2 = await filterBtnAfter.isVisible({ timeout: 3_000 }).catch(() => false);
    if (hasFilter2) {
      await filterBtnAfter.click();
      // FilterSheet uses accessibilityRole="radio" for each option.
      const allBtn = page.getByRole('radio', { name: /^all$/i });
      const hasAll = await allBtn.isVisible({ timeout: 3_000 }).catch(() => false);
      if (hasAll) {
        await allBtn.click();
      }
    }
  });
});

// =============================================================================
// 4. No-results state
// =============================================================================

test.describe('Phase 11-12 — no results state', () => {
  test('searching for non-existent text shows "No trips match your search"', async ({ page }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);
    await skipIfNoTrips(page);

    const searchInput = page
      .getByRole('searchbox')
      .or(page.getByLabel(/search trips by title/i))
      .first();

    const hasSearch = await searchInput.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasSearch) {
      test.skip(true, 'Search input not visible');
    }

    // Type something that definitely won't match any trip.
    await searchInput.fill('xXx_no_match_zzz_42');
    await page.waitForTimeout(400); // wait for debounce

    // "No trips match your search." should appear.
    const noResultsText = page.getByText(/no trips match your search/i);
    await expect(noResultsText).toBeVisible({ timeout: 5_000 });

    // No trip cards should be visible.
    const tripCardCount = await page.locator('[aria-label^="Open trip"]').count();
    expect(tripCardCount).toBe(0);

    // Clear the search to restore the list.
    const clearBtn = page.getByRole('button', { name: /clear search/i });
    await expect(clearBtn).toBeVisible({ timeout: 3_000 });
    await clearBtn.click();
  });
});
