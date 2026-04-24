/**
 * clipboard.web.ts — Clipboard write on web via the Clipboard API.
 * The native counterpart (clipboard.native.ts) uses expo-clipboard.
 *
 * navigator.clipboard is only available in secure contexts (HTTPS / localhost).
 * Falls back to the deprecated document.execCommand on older browsers / insecure origins.
 */

/**
 * Copies text to the system clipboard.
 * Returns true on success, false on failure.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Modern Clipboard API (secure contexts only)
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }

  // Legacy execCommand fallback
  if (typeof document !== 'undefined') {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.style.position = 'fixed';
      el.style.opacity = '0';
      document.body.appendChild(el);
      el.focus();
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }

  return false;
}
