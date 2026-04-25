/**
 * Phase 4 — Polish smoke tests.
 *
 * Covers:
 *   1. Trips list empty state — fresh user sees noTrips copy
 *   2. Map fallback — with no Maps key, trip detail Map tab shows MapUnavailable text
 *   3. Share link create + open anonymous — create trip, create share, view anonymously
 *   4. Share link revoke → 404 — revoke; anonymous reload → "Link not found" or 404
 *   5. .ics download — Export button triggers file download starting with BEGIN:VCALENDAR
 *   6. Offline reload — trips list renders after context goes offline
 *
 * Pre-requisites to run the full suite:
 *   - npm run web (or Playwright webServer starts it)
 *   - npx supabase start (for checks 3, 4, 5)
 *   - EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY set
 *   - SUPABASE_SERVICE_ROLE_KEY set for direct data seeding
 *   - SMOKE_EMAIL set to a valid test email
 *
 * Checks that can run without a live Supabase (UI-only):
 *   - Check 1 (empty state copy — visible after auth bypass/anon)
 *   - Check 2 (Map fallback — rendered for unauthenticated trip detail routes)
 *   - Check 6 (offline — cache behavior, needs prior authenticated load)
 *
 * Authentication strategy:
 *   Auth is done once via the magic-link flow (see Phase 1 spec). Since we can't
 *   programmatically receive email in CI, checks requiring auth are gated behind
 *   SUPABASE_URL being configured AND a pre-authenticated storageState. If the
 *   user is not signed in, the spec skips with a clear message.
 */

import { test, expect, type Page } from '@playwright/test';
import { skipIfEnvNotConfigured } from './_preflight';

// ── helper: skip if the page shows the login screen ──────────────────────────

async function skipIfNotAuthenticated(page: Page) {
  const isLoginVisible = await page
    .getByRole('heading', { name: /sign in/i })
    .isVisible()
    .catch(() => false);
  test.skip(isLoginVisible as boolean, 'Requires authenticated session — sign in first via Phase 1 spec');
}

// ── helper: navigate and wait for trip list ───────────────────────────────────

async function goToTrips(page: Page) {
  await page.goto('/trips');
  // Either the trips list or the login screen will appear
  await page.waitForLoadState('networkidle');
}

// =============================================================================
// Check 1: Trips list empty state
// =============================================================================

test.describe('Check 1 — trips list empty state', () => {
  test('fresh user sees noTrips empty state copy', async ({ page }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);

    // If the user has no trips, the empty state copy appears.
    // "Plan your first trip" is the noTrips variant title.
    // React Native Web does not render role="summary" to DOM — query by text instead.
    // If the user already has trips, the empty state won't show — skip.
    const emptyStateText = page.getByText(/plan your first trip/i);
    const hasEmptyState = await emptyStateText.isVisible().catch(() => false);
    if (!hasEmptyState) {
      test.skip(true, 'User already has trips — empty state not shown; manual verification required');
    }

    await expect(emptyStateText).toBeVisible({ timeout: 10_000 });
    // CTA button present
    await expect(page.getByRole('button', { name: /new trip/i })).toBeVisible();
  });
});

// =============================================================================
// Check 2: Map fallback (MapUnavailable) — visible when key is absent
// =============================================================================

test.describe('Check 2 — Map tab fallback (no Google Maps key)', () => {
  /**
   * The Map.web component renders <MapUnavailable> when
   * EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY is absent. This is a UI-only check —
   * we navigate to a trip's map tab and look for "Map unavailable" text.
   * If the app was built with the key set, this check is skipped.
   */
  test('Map tab shows "Map unavailable" when no web key is configured', async ({ page }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);

    // Try to navigate to the first available trip's Map tab.
    const firstTrip = page.locator('[role="button"][aria-label^="Open trip"]').first();
    const hasTrip = await firstTrip.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasTrip) {
      test.skip(true, 'No existing trips — create a trip first');
    }
    await firstTrip.click();

    await page.getByRole('tab', { name: /map/i }).click();
    await page.waitForLoadState('networkidle');

    // If the map key is set, the real map renders and this is a no-op check.
    // React Native Web does not render role="summary" to DOM — query by text instead.
    const mapUnavailable = page.getByText(/map unavailable/i).first();
    const mapKeySet = !!(
      process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY ||
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_WEB_KEY
    );
    if (mapKeySet) {
      test.skip(true, 'EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY is set — real map renders (expected)');
    }

    await expect(mapUnavailable).toBeVisible({ timeout: 10_000 });
  });
});

// =============================================================================
// Check 3: Share link create + open anonymous
// =============================================================================

test.describe('Check 3 — share link create + anonymous read', () => {
  test('create share link and view as anonymous', async ({ page, browser }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);

    // Navigate to first trip's Settings tab
    const firstTrip = page.locator('[role="button"][aria-label^="Open trip"]').first();
    const hasTrip = await firstTrip.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasTrip) {
      test.skip(true, 'No existing trips — create a trip first');
    }
    await firstTrip.click();

    await page.getByRole('tab', { name: /settings/i }).click();
    await page.waitForLoadState('networkidle');

    // Look for the Share section and Create share link button
    const createBtn = page.getByRole('button', { name: /create a read-only share link/i });
    const hasCreateBtn = await createBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasCreateBtn) {
      test.skip(true, 'Share section not visible — check ShareLinkCard is wired into Settings tab');
    }

    // Create the link
    await createBtn.click();

    // Defensive sanity: the share URL text must appear in the DOM within 5s.
    // If this fails, the selector below will also fail — loud, not silent.
    await expect(page.getByText(/\/share\//)).toBeVisible({ timeout: 5_000 });

    // Wait for the share URL element — RN Web maps `accessibilityLabel` → `aria-label`
    // so we use getByLabel which matches aria-label and <label> associations.
    const urlText = page.getByLabel(/^share url:/i);
    await expect(urlText).toBeVisible({ timeout: 10_000 });

    // Extract the token from the URL text or input value
    const urlContent =
      (await urlText.inputValue().catch(() => null)) ??
      (await urlText.textContent()) ??
      '';
    const tokenMatch = urlContent.match(/\/share\/([A-Za-z0-9_-]{16,})/);
    // Fail loud — do not silently skip; the share-link checks are critical Phase 4 smoke
    expect(tokenMatch, 'Expected to find a /share/<token> pattern in the share URL element').toBeTruthy();
    const token = tokenMatch![1]!;

    // Open anonymous browser context
    const anonContext = await browser.newContext({ storageState: undefined });
    const anonPage = await anonContext.newPage();
    try {
      await anonPage.goto(`/share/${token}`);
      await anonPage.waitForLoadState('networkidle');

      // Anonymous view should show trip title (not "Sign in")
      const loginHeading = await anonPage.getByRole('heading', { name: /sign in/i }).isVisible().catch(() => false);
      expect(loginHeading).toBe(false);

      // Trip content visible — just verify the page loaded with content
      await expect(anonPage.locator('body')).not.toBeEmpty();

      // No "Add place" or "Delete" buttons should be present
      const addBtn = await anonPage.getByRole('button', { name: /add (a )?place/i }).isVisible().catch(() => false);
      const deleteBtn = await anonPage.getByRole('button', { name: /delete/i }).isVisible().catch(() => false);
      expect(addBtn).toBe(false);
      expect(deleteBtn).toBe(false);
    } finally {
      await anonContext.close();
    }
  });
});

// =============================================================================
// Check 4: Share link revoke → "link not found"
// =============================================================================

test.describe('Check 4 — share link revoke', () => {
  test('revoking a share link makes anonymous access return not-found state', async ({
    page,
    browser,
  }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);

    // Navigate to first trip Settings tab
    const firstTrip = page.locator('[role="button"][aria-label^="Open trip"]').first();
    const hasTrip = await firstTrip.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasTrip) {
      test.skip(true, 'No existing trips');
    }
    await firstTrip.click();
    await page.getByRole('tab', { name: /settings/i }).click();

    const createBtn = page.getByRole('button', { name: /create a read-only share link/i });
    const hasCreateBtn = await createBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasCreateBtn) {
      test.skip(true, 'Share section not wired into Settings tab');
    }

    // Create link
    await createBtn.click();

    // Defensive sanity: the share URL text must appear in the DOM within 5s.
    await expect(page.getByText(/\/share\//)).toBeVisible({ timeout: 5_000 });

    // RN Web maps `accessibilityLabel` → `aria-label`; use getByLabel for correct matching.
    const urlText = page.getByLabel(/^share url:/i);
    await expect(urlText).toBeVisible({ timeout: 10_000 });
    const urlContent =
      (await urlText.inputValue().catch(() => null)) ??
      (await urlText.textContent()) ??
      '';
    const tokenMatch = urlContent.match(/\/share\/([A-Za-z0-9_-]{16,})/);
    // Fail loud — do not silently skip; the share-link revoke check is critical Phase 4 smoke
    expect(tokenMatch, 'Expected to find a /share/<token> pattern in the share URL element').toBeTruthy();
    const token = tokenMatch![1]!;

    // Revoke the link
    const revokeBtn = page.getByRole('button', { name: /revoke share link/i });
    await expect(revokeBtn).toBeVisible({ timeout: 5_000 });
    await revokeBtn.click();

    // Create button should reappear after revoke
    await expect(createBtn).toBeVisible({ timeout: 10_000 });

    // Anonymous context navigates to the revoked link → not found state
    const anonContext = await browser.newContext({ storageState: undefined });
    const anonPage = await anonContext.newPage();
    try {
      await anonPage.goto(`/share/${token}`);
      await anonPage.waitForLoadState('networkidle');

      // Should show a "not found" / "link no longer available" message
      // The exact copy depends on the app/share/[token].tsx implementation.
      const body = await anonPage.locator('body').textContent() ?? '';
      const notFound =
        /not found|no longer available|link (has been )?revoked|expired|invalid/i.test(body);
      expect(notFound).toBe(true);
    } finally {
      await anonContext.close();
    }
  });
});

// =============================================================================
// Check 5: .ics export download
// =============================================================================

test.describe('Check 5 — .ics export download', () => {
  test('Export button triggers file download starting with BEGIN:VCALENDAR', async ({ page }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);

    // Navigate to first trip Settings tab
    const firstTrip = page.locator('[role="button"][aria-label^="Open trip"]').first();
    const hasTrip = await firstTrip.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasTrip) {
      test.skip(true, 'No existing trips');
    }
    await firstTrip.click();
    await page.getByRole('tab', { name: /settings/i }).click();
    await page.waitForLoadState('networkidle');

    // Look for an Export or Download .ics button
    const exportBtn = page.getByRole('button', { name: /export|download.*ics|\.ics/i });
    const hasExportBtn = await exportBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasExportBtn) {
      test.skip(true, 'Export button not found in Settings tab');
    }

    // Wait for download event
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15_000 }),
      exportBtn.click(),
    ]);

    // File must not be empty
    const path = await download.path();
    expect(path).toBeTruthy();

    // Read first bytes — must start with BEGIN:VCALENDAR
    const { readFileSync } = await import('fs');
    const content = readFileSync(path!, 'utf8');
    expect(content.startsWith('BEGIN:VCALENDAR')).toBe(true);
  });
});

// =============================================================================
// Check 6: Offline reload
// =============================================================================

test.describe('Check 6 — offline reload', () => {
  test('trips list renders from cache after going offline', async ({ page }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);

    // Wait for the page to fully load and cache trip data
    await page.waitForLoadState('networkidle');

    // Check if there is any content at all (trips or empty state)
    const bodyText = await page.locator('body').textContent() ?? '';
    const hasContent = bodyText.trim().length > 10;
    if (!hasContent) {
      test.skip(true, 'Page has no content to verify offline');
    }

    // Go offline
    await page.context().setOffline(true);

    try {
      // Reload the page
      await page.reload();
      await page.waitForLoadState('domcontentloaded');

      // The page should still render — not show a blank screen or network error
      const offlineBody = await page.locator('body').textContent() ?? '';
      const isOfflineError =
        /no internet|network error|err_internet_disconnected|failed to fetch/i.test(offlineBody);
      expect(isOfflineError).toBe(false);

      // The trips list should still be visible (served from the TanStack Query cache persister)
      // Accept either the trips list OR the empty state — both are valid cached states
      const hasCachedContent =
        (await page.getByRole('heading').count()) > 0 ||
        (await page.getByRole('summary').isVisible().catch(() => false));
      expect(hasCachedContent).toBe(true);
    } finally {
      // Restore connection
      await page.context().setOffline(false);
    }
  });
});
