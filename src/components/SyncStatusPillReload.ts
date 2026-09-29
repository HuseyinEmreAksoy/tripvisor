/**
 * Reload hook for SyncStatusPill's "restart required" sheet. Native has no
 * in-app reload without expo-updates, so the sheet asks the user to close
 * and reopen the app instead. See SyncStatusPillReload.web.ts.
 */
export const reloadApp: (() => void) | null = null;
