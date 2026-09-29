/**
 * Web: a full page reload re-runs the Tier-1 sync boot for the signed-in
 * user (hydrate.ts refuses to re-attach to a different user in-process).
 */
export const reloadApp: (() => void) | null = () => {
  window.location.reload();
};
