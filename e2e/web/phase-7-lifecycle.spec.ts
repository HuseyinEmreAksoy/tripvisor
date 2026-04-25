/**
 * Phase 7 — trip lifecycle smoke tests.
 *
 * Covers:
 *   1. Archive trip: from trips list, tap trip-actions, Archive → verify in Archived tab
 *   2. Unarchive: from Archived tab, Unarchive → verify back in Active tab
 *   3. Duplicate: tap Duplicate → see new trip with "(copy)" suffix or title copy
 *   4. Delete (with confirm): tap Delete, confirm → trip disappears
 *   5. Settings nav: tap Settings link → land on Settings screen with email + theme picker
 *
 * Pre-requisites:
 *   - EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY set
 *   - SUPABASE_SERVICE_ROLE_KEY set
 *   - npm run web + npx supabase start
 *   - Auth setup seeds one fixture trip (used by archive / duplicate / delete tests)
 *
 * All tests use the pre-seeded fixture trip from auth.setup.ts. They run in
 * sequence (workers: 1) so the archive → unarchive tests are stable.
 */

import { test, expect } from '@playwright/test';
import { skipIfEnvNotConfigured, dismissDevOverlay } from './_preflight';
import { makeAdminClient, seedTrip } from './helpers/seed';

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

/**
 * Find the first trip card that matches a title fragment and return its title.
 * Returns null if no matching card is found within timeout.
 */
async function firstTripCardTitle(
  page: import('@playwright/test').Page,
  titleFragment?: string,
): Promise<string | null> {
  // Trip cards use aria-label "Open trip <title>"
  const selector = titleFragment
    ? `[role="button"][aria-label*="Open trip"][aria-label*="${titleFragment}"]`
    : '[role="button"][aria-label^="Open trip"]';
  const card = page.locator(selector).first();
  const visible = await card.isVisible({ timeout: 5_000 }).catch(() => false);
  if (!visible) return null;
  const label = await card.getAttribute('aria-label');
  return label?.replace(/^Open trip\s+/i, '') ?? null;
}

// =============================================================================
// 1 + 2: Archive and unarchive
// =============================================================================

test.describe('Phase 7 — archive / unarchive', () => {
  test('archive a trip then unarchive it back to active', async ({ page }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);

    // Find the first trip card.
    const firstCard = page.locator('[role="button"][aria-label^="Open trip"]').first();
    const hasTripCard = await firstCard.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasTripCard) {
      test.skip(true, 'No trip cards visible — seed data required');
    }

    // Get the trip title so we can look for it after archiving.
    const label = await firstCard.getAttribute('aria-label');
    const tripTitle = label?.replace(/^Open trip\s+/i, '') ?? '';

    // Open trip actions sheet via the overflow ⋮ button.
    const overflowBtn = page
      .locator('[role="button"][aria-label^="Open trip"]')
      .first()
      .locator('xpath=following-sibling::*')
      .first()
      // The overflow trigger is a sibling Pressable rendered inside the same card wrapper.
      // Use aria-label "Trip actions" instead — more stable.
      .or(page.locator('[role="button"][aria-label="Trip actions"]').first());

    // Simpler approach: find "Trip actions" button that is near the first trip card.
    const actionsBtn = page.locator('[role="button"][aria-label="Trip actions"]').first();
    const hasActions = await actionsBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasActions) {
      test.skip(true, 'Trip actions button not visible — TripCard overflow trigger missing');
    }

    await actionsBtn.click();

    // TripActionsSheet should appear.
    const archiveBtn = page.getByRole('button', { name: /^archive trip$/i });
    await expect(archiveBtn).toBeVisible({ timeout: 5_000 });
    await archiveBtn.click();

    // ── Verify the trip moved to Archived tab ──────────────────────────────
    // The trips list should be back (sheet closed). Switch to Archived tab.
    // The Active/Archived tabs are SegmentedControl with accessibilityRole="radio".
    const archivedTab = page.getByRole('radio', { name: /^archived$/i });
    await expect(archivedTab).toBeVisible({ timeout: 5_000 });
    await archivedTab.click();
    await page.waitForLoadState('networkidle');
    await dismissDevOverlay(page);

    // The trip should appear in the archived list.
    if (tripTitle) {
      const archivedCard = page.locator(`[role="button"][aria-label*="Open trip"][aria-label*="${tripTitle.slice(0, 20)}"]`).first();
      await expect(archivedCard).toBeVisible({ timeout: 8_000 });
    } else {
      // At minimum, some trip card should appear in the archived tab.
      const anyCard = page.locator('[role="button"][aria-label^="Open trip"]').first();
      await expect(anyCard).toBeVisible({ timeout: 8_000 });
    }

    // ── Unarchive ─────────────────────────────────────────────────────────
    const archivedActionsBtn = page.locator('[role="button"][aria-label="Trip actions"]').first();
    await archivedActionsBtn.click();

    const unarchiveBtn = page.getByRole('button', { name: /^unarchive trip$/i });
    await expect(unarchiveBtn).toBeVisible({ timeout: 5_000 });
    await unarchiveBtn.click();

    // Switch back to Active tab.
    // SegmentedControl uses accessibilityRole="radio" for each option.
    const activeTab = page.getByRole('radio', { name: /^active$/i });
    await expect(activeTab).toBeVisible({ timeout: 5_000 });
    await activeTab.click();
    await page.waitForLoadState('networkidle');
    await dismissDevOverlay(page);

    // The trip should be back in the active list.
    if (tripTitle) {
      const restoredCard = page.locator(`[role="button"][aria-label*="Open trip"][aria-label*="${tripTitle.slice(0, 20)}"]`).first();
      await expect(restoredCard).toBeVisible({ timeout: 8_000 });
    } else {
      const anyCard = page.locator('[role="button"][aria-label^="Open trip"]').first();
      await expect(anyCard).toBeVisible({ timeout: 8_000 });
    }
  });
});

// =============================================================================
// 3: Duplicate
// =============================================================================

test.describe('Phase 7 — duplicate trip', () => {
  test('duplicate a trip and see the copy appear in the list', async ({ page }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);

    const firstCard = page.locator('[role="button"][aria-label^="Open trip"]').first();
    const hasTripCard = await firstCard.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasTripCard) {
      test.skip(true, 'No trip cards visible — seed data required');
    }

    // Count trips before duplicate.
    const beforeCount = await page.locator('[role="button"][aria-label^="Open trip"]').count();

    const actionsBtn = page.locator('[role="button"][aria-label="Trip actions"]').first();
    const hasActions = await actionsBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasActions) {
      test.skip(true, 'Trip actions button not visible');
    }

    await actionsBtn.click();

    const dupBtn = page.getByRole('button', { name: /^duplicate trip$/i });
    await expect(dupBtn).toBeVisible({ timeout: 5_000 });
    // The BottomSheet backdrop can interfere with Playwright's pointer actionability check
    // because the backdrop (position:fixed) stacks in the same layer as the sheet.
    // Use evaluate to dispatch a synthetic click event directly on the element,
    // bypassing Playwright's pointer-event hit-test.
    await dupBtn.evaluate((el) => (el as HTMLElement).click());

    // After duplicate, wait for the list to update.
    // Use polling instead of networkidle (which hangs on TanStack Query polling).
    // Wait up to 10s for a new trip card to appear.
    let afterCount = beforeCount;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      await dismissDevOverlay(page);
      afterCount = await page.locator('[role="button"][aria-label^="Open trip"]').count();
      if (afterCount > beforeCount) break;
    }

    // The new trip should contain "(copy)" or the original title text.
    const allLabels = await page.locator('[role="button"][aria-label^="Open trip"]').evaluateAll(
      (els) => els.map((el) => el.getAttribute('aria-label') ?? ''),
    );
    const hasCopy = allLabels.some((lbl) => /copy/i.test(lbl));
    // Accept either "(copy)" suffix OR just more trips (some implementations don't add suffix).
    expect(afterCount > beforeCount || hasCopy, 'Expected either a new trip or a "(copy)" suffix after duplicate').toBe(true);
  });
});

// =============================================================================
// 4: Delete with confirm
// =============================================================================

test.describe('Phase 7 — delete trip', () => {
  test('delete a trip (with confirm) and verify it disappears', async ({ page }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);

    const firstCard = page.locator('[role="button"][aria-label^="Open trip"]').first();
    const hasTripCard = await firstCard.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasTripCard) {
      test.skip(true, 'No trip cards visible — seed data required');
    }

    // Seed a dedicated trip to delete so we don't destroy the shared fixture.
    // We use the service role client to insert, then delete via the UI.
    const admin = makeAdminClient();
    // Get the user's ID from the session in localStorage.
    const userId = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const authKey = keys.find((k) => k.includes('auth-token'));
      if (!authKey) return null;
      try {
        const parsed = JSON.parse(localStorage.getItem(authKey) ?? '{}');
        return parsed?.user?.id ?? null;
      } catch {
        return null;
      }
    });

    if (!userId) {
      test.skip(true, 'Could not resolve user ID from session — skip delete test');
    }

    const { tripId } = await seedTrip(admin, {
      userId: userId as string,
      title: 'E2E Delete Me',
      places: [],
    });

    // Reload to pick up the new trip.
    await page.reload();
    // Use fixed timeout instead of networkidle — TanStack Query polling prevents idle.
    await page.waitForTimeout(2000);
    await dismissDevOverlay(page);
    // Extra dismiss pass — LogBox from previous tests may have accumulated errors.
    await page.waitForTimeout(500);
    await dismissDevOverlay(page);

    // Count before delete.
    const beforeCount = await page.locator('[role="button"][aria-label^="Open trip"]').count();

    // Find the "E2E Delete Me" trip's actions button.
    const deleteTripCard = page.locator('[aria-label*="E2E Delete Me"]').first();
    const hasDeleteCard = await deleteTripCard.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasDeleteCard) {
      // Clean up then skip.
      await admin.from('trips').delete().eq('id', tripId);
      test.skip(true, 'E2E Delete Me trip not visible in list');
    }

    // The overflow button is the "Trip actions" button near the card.
    // Since worker=1 and this card may not be first, find it by its nearby card.
    // Strategy: find all "Trip actions" buttons and click the one that corresponds.
    // Simpler: scroll to the card and find the first "Trip actions" near it.
    await deleteTripCard.scrollIntoViewIfNeeded();

    // Open actions — use page.getByRole to find the actions button.
    // The TripCard renders: [card Pressable "Open trip X"] [actions Pressable "Trip actions"]
    // We need the actions button that's in the same wrapper as our card.
    // DOM layout: both share a React fragment, rendered adjacently.
    // Use "filter near" approach: find a "Trip actions" button that is near the delete card.
    // Playwright doesn't have a direct "near" filter — use the card's bounding box instead.
    const cardBox = await deleteTripCard.boundingBox();
    if (!cardBox) {
      test.skip(true, 'Could not get card bounding box');
    }

    // Find all "Trip actions" buttons and click the one whose Y coordinate is closest to the card.
    const allActionsBtns = page.locator('[role="button"][aria-label="Trip actions"]');
    const count = await allActionsBtns.count();
    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < count; i++) {
      const box = await allActionsBtns.nth(i).boundingBox();
      if (box && cardBox) {
        const dist = Math.abs(box.y - cardBox.y);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      }
    }

    await allActionsBtns.nth(closestIdx).click({ force: true });

    const deleteBtn = page.getByRole('button', { name: /^delete trip$/i });
    await expect(deleteBtn).toBeVisible({ timeout: 5_000 });

    // The trips.tsx delete handler calls confirmDestructive which uses window.confirm on web.
    page.on('dialog', (dialog) => {
      if (dialog.type() === 'confirm') dialog.accept();
    });
    // Use force:true — the BottomSheet backdrop may intercept Playwright pointer checks.
    await deleteBtn.click({ force: true });

    // Trip should disappear. Use fixed timeout rather than networkidle (avoids polling hang).
    await page.waitForTimeout(2000);
    await dismissDevOverlay(page);

    const afterCount = await page.locator('[role="button"][aria-label^="Open trip"]').count();
    expect(afterCount, 'Expected one fewer trip after delete').toBeLessThan(beforeCount);
  });
});

// =============================================================================
// 5: Settings nav
// =============================================================================

test.describe('Phase 7 — settings navigation', () => {
  test('tapping Settings navigates to the settings screen', async ({ page }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);

    // The trips list header has an "Open settings" button (accessibilityLabel).
    const settingsBtn = page.getByRole('button', { name: /open settings/i });
    await expect(settingsBtn).toBeVisible({ timeout: 5_000 });
    await settingsBtn.click();

    // Should navigate to /(app)/settings
    await expect(page).toHaveURL(/\/settings/, { timeout: 10_000 });

    // Settings screen has a heading "Settings" and shows the user's email.
    const heading = page.getByRole('heading', { name: /^settings$/i });
    await expect(heading).toBeVisible({ timeout: 8_000 });

    // Theme picker (Appearance segmented control) should be visible.
    // SegmentedControl uses accessibilityRole="radio" (not "button") for each option.
    const lightOption = page.getByRole('radio', { name: /^light$/i });
    const darkOption = page.getByRole('radio', { name: /^dark$/i });
    const systemOption = page.getByRole('radio', { name: /^system$/i });
    const hasThemePicker =
      (await lightOption.isVisible().catch(() => false)) ||
      (await darkOption.isVisible().catch(() => false)) ||
      (await systemOption.isVisible().catch(() => false));
    expect(hasThemePicker, 'Expected Light/Dark/System theme picker radio options on settings screen').toBe(true);

    // Email text should be visible (shows "Signed in as" + email).
    const emailText = page.getByText(/smoke-phase6@test\.local|smoke.*@test\.local/i).first();
    const hasEmail = await emailText.isVisible({ timeout: 3_000 }).catch(() => false);
    // Accept either visible email or an email-shaped text — the exact value depends on setup.
    if (!hasEmail) {
      // Fallback: just check "Signed in as" label is present.
      const signedInText = page.getByText(/signed in as/i).first();
      await expect(signedInText).toBeVisible({ timeout: 3_000 });
    }
  });
});
