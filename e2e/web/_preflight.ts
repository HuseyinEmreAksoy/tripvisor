import { test } from '@playwright/test';

/**
 * Shared pre-flight check.
 *
 * The Phase 1–3 golden-path smokes all need a real Supabase project.
 * If EXPO_PUBLIC_SUPABASE_URL is unset or still the REPLACE_ME placeholder,
 * skip the spec with a clear message — a failed suite wastes signal.
 */
export function skipIfEnvNotConfigured() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const placeholder = !url || /replace_?me/i.test(url) || !key;
  test.skip(
    placeholder,
    'EXPO_PUBLIC_SUPABASE_URL / ANON_KEY not set — fill .env with a real Supabase project before running smoke',
  );
}

/**
 * Dev email the smoke uses. The Supabase project must have email signups enabled
 * AND the address must be on the "allowed test senders" allow-list, OR email
 * confirmation must be disabled for dev. Override with SMOKE_EMAIL env var.
 */
export function smokeEmail(): string {
  return process.env.SMOKE_EMAIL ?? `smoke-${Date.now()}@test.local`;
}
