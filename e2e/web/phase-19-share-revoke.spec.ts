/**
 * Phase 19 — Share link revoke regression test.
 *
 * CRITICAL: Phase 19 fixed a bug where revoking a share link was a silent no-op.
 * This spec is the mandatory regression check — if revoke silently no-ops again,
 * the anonymous read will still succeed and this test will fail loudly.
 *
 * Flow:
 *   1. Navigate to a trip's Settings tab.
 *   2. Create a share link — capture the token from the displayed URL.
 *   3. Verify the anonymous context can read the share page (link is valid).
 *   4. Revoke the link from the authenticated context.
 *   5. Verify the anonymous context can NO LONGER read the share page.
 *      (This is the regression assertion — if revoke is broken, anonymous read
 *       still works and the test fails.)
 *
 * Pre-requisites:
 *   - EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY set
 *   - SUPABASE_SERVICE_ROLE_KEY set (for auth setup seed)
 *   - npx supabase start
 *   - npm run web
 *
 * Selector notes (from ShareLinkCard.tsx):
 *   - "Create share link" button: accessibilityLabel "Create a read-only share link for this trip"
 *   - URL display View: accessible=true, accessibilityLabel "Share URL: <url>"
 *   - "Revoke link" button: accessibilityLabel "Revoke share link — anyone with the link will lose access"
 *   - After revoke, "Create share link" button reappears.
 *
 * Share page (app/share/[token].tsx) on invalid token renders:
 *   EmptyState title="Link not found" body="This trip has been deleted or the share link was revoked."
 */

import { test, expect } from '@playwright/test';
import { skipIfEnvNotConfigured, dismissDevOverlay } from './_preflight';

// ── helpers ───────────────────────────────────────────────────────────────────

async function skipIfNotAuthenticated(page: import('@playwright/test').Page) {
  const isLogin = await page
    .getByRole('heading', { name: /sign in/i })
    .isVisible()
    .catch(() => false);
  test.skip(isLogin as boolean, 'Requires authenticated session from auth.setup.ts');
}

async function goToTrips(page: import('@playwright/test').Page) {
  await page.goto('/trips');
  await page.waitForLoadState('networkidle');
  await dismissDevOverlay(page);
}

// =============================================================================
// REGRESSION TEST: share link revoke
// =============================================================================

test.describe('Phase 19 — share link revoke regression', () => {
  test('revoked share link returns "Link not found" to anonymous viewers', async ({
    page,
    browser,
  }) => {
    skipIfEnvNotConfigured();
    await goToTrips(page);
    await skipIfNotAuthenticated(page);

    // ── Step 1: Navigate to first trip's Settings tab ─────────────────────────
    const firstTrip = page.locator('[role="button"][aria-label^="Open trip"]').first();
    const hasTrip = await firstTrip.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasTrip) {
      test.skip(true, 'No existing trips — seed data required');
    }
    await firstTrip.click();
    await expect(page).toHaveURL(/\/trip\/[0-9a-f-]+$/, { timeout: 10_000 });
    await dismissDevOverlay(page);

    // Switch to Settings tab.
    const settingsTab = page
      .getByRole('tab', { name: /settings/i })
      .or(page.getByRole('button', { name: /^settings$/i }))
      .first();
    await expect(settingsTab).toBeVisible({ timeout: 5_000 });
    await settingsTab.click();
    await page.waitForLoadState('networkidle');
    await dismissDevOverlay(page);

    // ── Step 2: Create share link ─────────────────────────────────────────────
    // ShareLinkCard.tsx renders "Create share link" button initially.
    const createBtn = page.getByRole('button', {
      name: /create a read-only share link for this trip/i,
    });
    const hasCreateBtn = await createBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    if (!hasCreateBtn) {
      test.skip(true, 'Share link create button not visible — check ShareLinkCard is in Settings tab');
    }

    await createBtn.click();

    // The URL display View has accessibilityLabel "Share URL: <url>".
    // We locate it as an element with that aria-label and extract the URL.
    await expect(page.getByText(/\/share\//)).toBeVisible({ timeout: 8_000 });

    // Extract the token from the URL displayed in the DOM.
    const urlDisplayLocator = page.locator('[aria-label^="Share URL:"]');
    const hasUrlDisplay = await urlDisplayLocator.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!hasUrlDisplay) {
      test.skip(true, 'Share URL display element not visible after creating link');
    }

    const urlAriaLabel = await urlDisplayLocator.getAttribute('aria-label');
    // aria-label format: "Share URL: http://localhost:8081/share/<token>"
    const urlFromLabel = urlAriaLabel?.replace(/^share url:\s*/i, '').trim() ?? '';
    const tokenMatch = urlFromLabel.match(/\/share\/([A-Za-z0-9_-]{12,})/);

    // Fail loud — if the token is not extractable, this is a selector drift bug.
    expect(
      tokenMatch,
      `Expected to extract /share/<token> from aria-label "${urlAriaLabel}". ` +
        'The ShareLinkCard URL display element may have changed its aria-label format.',
    ).toBeTruthy();

    const token = tokenMatch![1]!;
    const shareUrl = `/share/${token}`;

    // ── Step 3: Verify anonymous read works BEFORE revoke ─────────────────────
    const anonContext = await browser.newContext({ storageState: undefined });
    const anonPage = await anonContext.newPage();
    try {
      await anonPage.goto(shareUrl);
      // Use fixed timeout instead of networkidle — TanStack Query polling prevents idle.
      await anonPage.waitForTimeout(3000);
      await dismissDevOverlay(anonPage);

      // Poll until the page resolves away from "Loading…" state (max 8s).
      let bodyBefore = '';
      for (let i = 0; i < 8; i++) {
        bodyBefore = (await anonPage.locator('body').textContent()) ?? '';
        if (!/loading/i.test(bodyBefore)) break;
        await anonPage.waitForTimeout(1000);
      }

      // The share page should NOT show "Link not found" before revoke.
      const isNotFoundBefore = /link not found|no longer available|revoked|expired|invalid/i.test(bodyBefore);
      expect(
        isNotFoundBefore,
        'Expected share link to be accessible BEFORE revoke, but got a "not found" page. ' +
          'Check if the create-link call actually succeeded.',
      ).toBe(false);

      // The trip title should appear (or at least some content — the read-only badge).
      const hasContent = bodyBefore.length > 50;
      expect(hasContent, 'Expected share page to have content before revoke').toBe(true);
    } finally {
      await anonPage.close();
    }

    // ── Step 4: Revoke the link ───────────────────────────────────────────────
    // Back in the authenticated page — revoke the link.
    const revokeBtn = page.getByRole('button', {
      name: /revoke share link/i,
    });
    await expect(revokeBtn).toBeVisible({ timeout: 5_000 });
    await revokeBtn.click();

    // After revoke, the "Create share link" button should reappear.
    // This confirms the UI-level revoke completed (mutation resolved).
    await expect(createBtn).toBeVisible({ timeout: 15_000 });

    // ── Step 5: Verify anonymous read NOW FAILS (regression assertion) ─────────
    // This is the critical check. If revoke was a silent no-op (Phase 19 bug),
    // the share page would still render and this assertion would fail loudly.
    const anonContext2 = await browser.newContext({ storageState: undefined });
    const anonPage2 = await anonContext2.newPage();
    try {
      await anonPage2.goto(shareUrl);
      // Use fixed timeout instead of networkidle — TanStack Query polling prevents idle.
      await anonPage2.waitForTimeout(3000);
      await dismissDevOverlay(anonPage2);

      // Poll until the page resolves away from "Loading…" state.
      let bodyAfter = '';
      for (let i = 0; i < 8; i++) {
        bodyAfter = (await anonPage2.locator('body').textContent()) ?? '';
        if (!/loading/i.test(bodyAfter)) break;
        await anonPage2.waitForTimeout(1000);
      }

      // The share page should render the "Link not found" EmptyState.
      // EmptyState title="Link not found" from app/share/[token].tsx:
      //   <EmptyState title="Link not found" body="This trip has been deleted or the share link was revoked." />
      // bodyAfter is already set above from the polling loop.
      const isNotFoundAfter = /link not found|no longer available|link.*revoked|deleted.*share|share.*deleted/i.test(bodyAfter);

      expect(
        isNotFoundAfter,
        `REGRESSION: Phase 19 bug detected — revoke was a silent no-op. ` +
          `After revoking the share link (token: ${token}), the anonymous share page ` +
          `still returned valid content instead of "Link not found". ` +
          `Body snippet: ${bodyAfter.slice(0, 300)}`,
      ).toBe(true);

      // Additionally confirm: the "Read-only view" badge or trip title should NOT appear.
      const hasReadOnlyBadge = /read-only view/i.test(bodyAfter);
      expect(
        hasReadOnlyBadge,
        `REGRESSION: "Read-only view" badge still visible after revoke — revoke did not work.`,
      ).toBe(false);
    } finally {
      await anonPage2.close();
      await anonContext2.close();
    }
  });
});

// =============================================================================
// Bonus: share link 404 on completely made-up token
// =============================================================================

test.describe('Phase 19 — invalid share token', () => {
  test('non-existent share token shows "Link not found"', async ({ page }) => {
    skipIfEnvNotConfigured();

    // Navigate as the anonymous / pre-authenticated user.
    // The share route is publicly accessible — no auth needed.
    await page.goto('/share/absolutely-made-up-token-xyz-99999');
    await page.waitForLoadState('networkidle');
    await dismissDevOverlay(page);

    // Poll until the page resolves away from "Loading…" state (max 10s).
    // TanStack Query may still be fetching when networkidle fires.
    let bodyText = '';
    for (let i = 0; i < 10; i++) {
      bodyText = (await page.locator('body').textContent()) ?? '';
      if (!/loading/i.test(bodyText)) break;
      await page.waitForTimeout(1000);
      await dismissDevOverlay(page);
    }

    // Accept any not-found pattern the share page renders.
    const isNotFound = /link not found|no longer available|revoked|expired|invalid|does not exist/i.test(bodyText);
    const isAuthRedirect = /sign in|log in|email/i.test(bodyText);

    expect(
      isNotFound || isAuthRedirect,
      `Expected "Link not found" or auth redirect for invalid token, got: ${bodyText.slice(0, 200)}`,
    ).toBe(true);
  });
});
