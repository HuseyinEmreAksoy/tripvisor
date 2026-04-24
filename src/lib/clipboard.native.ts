/**
 * clipboard.native.ts — Clipboard write on iOS and Android via expo-clipboard.
 * The web counterpart (clipboard.web.ts) uses navigator.clipboard.writeText.
 */
import * as Clipboard from 'expo-clipboard';

/**
 * Copies text to the system clipboard.
 * Returns true on success, false on failure.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}
