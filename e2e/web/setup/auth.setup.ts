/**
 * Playwright setup project — runs once before all chromium specs.
 *
 * Responsibilities:
 *   1. Create (or reuse) a deterministic test user via Supabase admin API,
 *      always re-setting the password to a known value (idempotent).
 *   2. Sign the user in via password (POST /auth/v1/token?grant_type=password)
 *      to obtain a full session.
 *   3. Boot a browser context, navigate to the app, and inject the session
 *      into localStorage at the key Supabase JS expects (sb-<host>-auth-token).
 *      The Supabase client picks up the session on first read.
 *   4. Persist the storage state (cookies + localStorage) to e2e/web/.auth/user.json.
 *   5. Seed one fixture trip with two places via the service-role client so
 *      checks 2-6 of phase-4-polish.spec.ts have a trip to operate on.
 *
 * SAFETY: refuses to run unless EXPO_PUBLIC_SUPABASE_URL points at localhost.
 *
 * Why password sign-in instead of magic-link verify:
 *   The app uses flowType: 'pkce', which does not auto-consume implicit-flow
 *   `#access_token=...` fragments returned by /auth/v1/verify. The result is a
 *   race where Root() redirects to /login before the URL hash is processed.
 *   Password sign-in via the admin-set password is the standard, deterministic
 *   pattern for Supabase E2E and avoids that race entirely.
 *
 *   The test user is created with `email_confirm: true` and a known password;
 *   no real magic-link flow is exercised here. Phase 1's spec already covers
 *   the magic-link UI path. This setup exists only to bootstrap an authenticated
 *   storage state for the auth-gated specs.
 */

import { test as setup, expect } from '@playwright/test';
import { mkdirSync, existsSync } from 'fs';
import { dirname } from 'path';
import { makeAdminClient, seedTrip } from '../helpers/seed';

const STORAGE_STATE_PATH = 'e2e/web/.auth/user.json';

interface AdminUser {
  id: string;
  email: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  user: { id: string; email?: string };
}

function assertLocal(url: string): void {
  if (!url) throw new Error('[auth.setup] EXPO_PUBLIC_SUPABASE_URL is not set');
  if (!/localhost|127\.0\.0\.1|54321/.test(url)) {
    throw new Error(
      `[auth.setup] Refusing to run against non-local Supabase: ${url}. ` +
        'Set EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 for E2E.',
    );
  }
}

/**
 * Derive the Supabase JS storage key from the URL.
 * Mirrors `sb-${baseUrl.hostname.split('.')[0]}-auth-token` in supabase-js.
 */
function deriveStorageKey(supabaseUrl: string): string {
  const host = new URL(supabaseUrl).hostname;
  return `sb-${host.split('.')[0]}-auth-token`;
}

setup('authenticate and seed fixture trip', async ({ browser }) => {
  // ── 0. Validate env ────────────────────────────────────────────────────────
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const email = process.env.SMOKE_EMAIL ?? 'smoke-phase6@test.local';
  const password = process.env.SMOKE_PASSWORD ?? 'pw-tripvisor-e2e-1234';

  assertLocal(supabaseUrl);
  if (!anonKey) throw new Error('[auth.setup] EXPO_PUBLIC_SUPABASE_ANON_KEY missing');
  if (!serviceKey) throw new Error('[auth.setup] SUPABASE_SERVICE_ROLE_KEY missing');

  const dir = dirname(STORAGE_STATE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const adminHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // ── 1. Create user (idempotent) — 200/201 created, 422/409 already-exists ──
  const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ email, email_confirm: true, password }),
  });
  if (!createRes.ok && createRes.status !== 422 && createRes.status !== 409) {
    throw new Error(
      `[auth.setup] admin/users create failed: HTTP ${createRes.status} — ${await createRes.text()}`,
    );
  }

  // ── 2. Resolve user id ─────────────────────────────────────────────────────
  const listRes = await fetch(
    `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    { headers: adminHeaders },
  );
  if (!listRes.ok) {
    throw new Error(
      `[auth.setup] admin/users list failed: HTTP ${listRes.status} — ${await listRes.text()}`,
    );
  }
  const listJson = (await listRes.json()) as { users?: AdminUser[] };
  const user = (listJson.users ?? []).find((u) => u.email === email);
  if (!user) throw new Error(`[auth.setup] user not found after create: ${email}`);
  const userId = user.id;

  // ── 3. Update password to known value (idempotent) ─────────────────────────
  // If the user already existed from a prior run with a different password, this
  // ensures we can sign in. Always-set is fine because this is a test-only user.
  const updateRes = await fetch(
    `${supabaseUrl}/auth/v1/admin/users/${userId}`,
    {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({ password, email_confirm: true }),
    },
  );
  if (!updateRes.ok) {
    throw new Error(
      `[auth.setup] admin/users update failed: HTTP ${updateRes.status} — ${await updateRes.text()}`,
    );
  }

  // ── 4. Sign in via password to get a full session ──────────────────────────
  const tokenRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!tokenRes.ok) {
    throw new Error(
      `[auth.setup] password sign-in failed: HTTP ${tokenRes.status} — ${await tokenRes.text()}`,
    );
  }
  const session = (await tokenRes.json()) as TokenResponse;
  if (!session.access_token) {
    throw new Error('[auth.setup] token response missing access_token');
  }

  // ── 5. Inject session into browser localStorage ────────────────────────────
  // Supabase JS reads from sb-<hostname-first-segment>-auth-token. We must
  // visit the origin first to scope localStorage; then write the session JSON.
  const storageKey = deriveStorageKey(supabaseUrl);
  const context = await browser.newContext();
  const page = await context.newPage();

  // Visit the app once so the origin exists in the browser context.
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  // Write the session before any further app interaction. Supabase JS will
  // hydrate from this on its next read.
  await page.evaluate(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: storageKey, value: JSON.stringify(session) },
  );

  // Navigate to /trips and confirm we're not bounced to /login.
  await page.goto('/trips', { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  // The session-bound page should land on /trips, not /login. If the redirect
  // bounces us to /login, the session injection didn't take.
  const url = page.url();
  expect(
    url.includes('/login'),
    `Expected to remain authenticated on /trips after session injection, but got ${url}`,
  ).toBe(false);

  // Sanity: the storage key should now be present (read via the page so we go
  // through the same Storage instance the app uses).
  const hasSession = await page.evaluate((k) => !!window.localStorage.getItem(k), storageKey);
  expect(hasSession, `Expected ${storageKey} in localStorage`).toBe(true);

  // ── 6. Persist storage state ───────────────────────────────────────────────
  await context.storageState({ path: STORAGE_STATE_PATH });
  await context.close();

  // ── 7. Seed one fixture trip with two places ───────────────────────────────
  const admin = makeAdminClient();
  await seedTrip(admin, {
    userId,
    title: `Phase 6 Smoke ${new Date().toISOString().slice(0, 10)}`,
    dailyHoursBudget: 8,
    transportMode: 'driving',
    places: [
      {
        google_place_id: 'manual-fixture-1',
        lat: 41.0082,
        lng: 28.9784,
        visit_duration_minutes: 60,
        user_title: 'Hagia Sophia (fixture)',
        category: 'tourist_attraction',
      },
      {
        google_place_id: 'manual-fixture-2',
        lat: 41.0136,
        lng: 28.955,
        visit_duration_minutes: 60,
        user_title: 'Suleymaniye Mosque (fixture)',
        category: 'tourist_attraction',
      },
    ],
  });
});
