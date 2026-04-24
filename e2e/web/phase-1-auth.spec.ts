import { test, expect } from '@playwright/test';
import { skipIfEnvNotConfigured, smokeEmail } from './_preflight';

test.describe('Phase 1 — auth + trip CRUD + place search', () => {
  test('app boots and reaches login screen', async ({ page }) => {
    await page.goto('/');
    // Either /login is rendered or root redirect has already fired.
    await expect(page).toHaveURL(/\/(login|trips)?$/);
    // "Sign in" heading should appear regardless of env configuration.
    const heading = page.getByRole('heading', { name: /sign in/i });
    await expect(heading).toBeVisible({ timeout: 15_000 });
  });

  test('login form validates empty email', async ({ page }) => {
    await page.goto('/login');
    const submit = page.getByRole('button', { name: /send magic link/i });
    // Disabled until valid email entered.
    await expect(submit).toBeDisabled();
  });

  test('login form accepts valid email and attempts magic-link send', async ({ page }) => {
    skipIfEnvNotConfigured();
    await page.goto('/login');
    await page.getByLabel('Email').fill(smokeEmail());
    const submit = page.getByRole('button', { name: /send magic link/i });
    await expect(submit).toBeEnabled();
    await submit.click();
    // Confirmation state appears when Supabase accepts the OTP request.
    await expect(page.getByRole('heading', { name: /check your inbox/i })).toBeVisible({
      timeout: 15_000,
    });
  });
});
