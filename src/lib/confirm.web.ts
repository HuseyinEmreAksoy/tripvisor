/**
 * confirm.web.ts — Destructive confirmation dialog on web.
 * The native counterpart (confirm.native.ts) uses React Native Alert.
 *
 * v1 uses window.confirm — simple, no third-party dep, acceptable per plan.
 * A custom modal can replace this in Phase 8 if needed.
 *
 * Metro resolves .web.ts before confirm.ts on web builds.
 * consumers import as `@/lib/confirm`.
 */

export interface ConfirmDestructiveOpts {
  title: string;
  message: string;
  confirmLabel: string;
  /** Native only: `window.confirm` labels its buttons in the browser's language. */
  cancelLabel?: string;
}

/**
 * Shows a browser-native confirm dialog.
 * Resolves true if the user clicked OK, false if they cancelled.
 */
export async function confirmDestructive(opts: ConfirmDestructiveOpts): Promise<boolean> {
  const text = `${opts.title}\n\n${opts.message}`;
  // window.confirm is synchronous; wrap in Promise for a consistent async API.
  return typeof window !== 'undefined' ? window.confirm(text) : false;
}
