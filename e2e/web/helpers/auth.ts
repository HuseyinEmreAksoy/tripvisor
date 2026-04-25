/**
 * Playwright auth fixture (Step 5.4).
 *
 * Signs a user in via the magic-link flow by:
 *   1. Triggering magic-link send via Supabase admin API.
 *   2. Fetching the email from Mailpit at http://127.0.0.1:54324.
 *   3. Extracting the magic link from the email body.
 *   4. Navigating to the magic link to complete sign-in.
 *   5. Persisting browser storage state to e2e/web/.auth/user.json.
 *
 * Reuse across tests:
 *   import { test } from './helpers/auth';
 *   test.use({ storageState: 'e2e/web/.auth/user.json' });
 *
 * SAFETY: Throws loud if EXPO_PUBLIC_SUPABASE_URL does not point to
 * localhost — prevents accidental runs against production auth.
 *
 * Prerequisites:
 *   - npx supabase start (provides local Supabase + Mailpit)
 *   - EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
 *   - EXPO_PUBLIC_SUPABASE_ANON_KEY set
 *   - SUPABASE_SERVICE_ROLE_KEY set
 *   - SMOKE_EMAIL set (e.g. smoke@test.local) — must be an allowed test email
 */

import { test as base, type BrowserContext } from '@playwright/test';

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
const STORAGE_STATE_PATH = 'e2e/web/.auth/user.json';

// ── Mailpit API types ─────────────────────────────────────────────────────────

interface MailpitMessage {
  ID: string;
  Subject: string;
  From: { Address: string };
  To: Array<{ Address: string }>;
}

interface MailpitMessagesResponse {
  messages: MailpitMessage[];
  total: number;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function assertLocalSupabase(): void {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  if (!url) {
    throw new Error(
      '[auth] EXPO_PUBLIC_SUPABASE_URL is not set. Set it to http://127.0.0.1:54321 for local auth.',
    );
  }
  if (!/localhost|127\.0\.0\.1|54321/.test(url)) {
    throw new Error(
      `[auth] Refusing to run magic-link auth against non-local Supabase: ${url}. ` +
        'This helper is for local dev only — set EXPO_PUBLIC_SUPABASE_URL to your local Supabase.',
    );
  }
}

/**
 * Poll Mailpit for an email sent to `toAddress` within `timeoutMs`.
 * Returns the HTML or text body of the matching message.
 */
async function fetchMagicLinkFromMailpit(
  toAddress: string,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=20`);
    if (!res.ok) throw new Error(`[auth] Mailpit returned ${res.status}`);
    const data = (await res.json()) as MailpitMessagesResponse;

    const msg = (data.messages ?? []).find((m) =>
      m.To?.some((t) => t.Address === toAddress),
    );
    if (msg) {
      // Fetch full message body
      const bodyRes = await fetch(`${MAILPIT_URL}/api/v1/message/${msg.ID}`);
      const bodyData = (await bodyRes.json()) as { HTML?: string; Text?: string };
      return bodyData.HTML ?? bodyData.Text ?? '';
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`[auth] Timed out waiting for magic link email to ${toAddress}`);
}

/**
 * Extract the Supabase magic link (auth/confirm?...) from email body.
 */
function extractMagicLink(body: string): string {
  // Supabase magic links look like: http://127.0.0.1:54321/auth/v1/verify?...
  // or the app deep link: exp://... or http://localhost:8081/auth/...
  const match = body.match(/href="([^"]*(?:auth\/confirm|auth\/v1\/verify)[^"]*)"/i)
    ?? body.match(/(https?:\/\/\S*(?:auth\/confirm|auth\/v1\/verify)\S*)/i);

  if (!match?.[1]) {
    throw new Error('[auth] Could not find magic link in email body');
  }
  return match[1].replace(/&amp;/g, '&');
}

// ── fixture ───────────────────────────────────────────────────────────────────

export interface AuthFixtures {
  /** A BrowserContext that has been authenticated via magic link. */
  authenticatedContext: BrowserContext;
}

/**
 * Playwright test base with an `authenticatedContext` fixture.
 * Use this fixture to get a pre-authenticated browser context.
 *
 * Usage:
 *   const { test, expect } = require('./helpers/auth');
 *   test('my test', async ({ page }) => { ... });  // page is authenticated
 */
export const test = base.extend<AuthFixtures>({
  authenticatedContext: async ({ browser }, use) => {
    assertLocalSupabase();

    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const email = process.env.SMOKE_EMAIL ?? `smoke-${Date.now()}@test.local`;

    // 1. Create user + send magic link via admin API
    const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, email_confirm: true, password: `pw-${Date.now()}` }),
    });
    if (!createRes.ok && createRes.status !== 409 /* already exists */) {
      const txt = await createRes.text();
      throw new Error(`[auth] Failed to create user ${email}: ${txt}`);
    }

    // 2. Trigger magic link
    const linkRes = await fetch(`${supabaseUrl}/auth/v1/magiclink`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });
    if (!linkRes.ok) {
      const txt = await linkRes.text();
      throw new Error(`[auth] Failed to send magic link: ${txt}`);
    }

    // 3. Fetch magic link from Mailpit
    const emailBody = await fetchMagicLinkFromMailpit(email);
    const magicLink = extractMagicLink(emailBody);

    // 4. Navigate to the magic link in a fresh browser context
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(magicLink);
    await page.waitForLoadState('networkidle');

    // 5. Save storage state for reuse
    await context.storageState({ path: STORAGE_STATE_PATH });
    await page.close();

    await use(context);
    await context.close();
  },
});

export { expect } from '@playwright/test';

/**
 * Helper: skip a test if the env is not configured for local Supabase auth.
 * Use at the top of any spec that requires an authenticated session.
 */
export function skipIfAuthNotConfigured(): void {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const isLocal = /localhost|127\.0\.0\.1/.test(url);
  base.skip(
    !url || !key || !isLocal,
    'Auth fixture requires local Supabase (EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 + SUPABASE_SERVICE_ROLE_KEY)',
  );
}
