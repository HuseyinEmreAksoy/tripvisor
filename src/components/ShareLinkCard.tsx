/**
 * ShareLinkCard — shows a trip's active share link (if one exists) with
 * copy-to-clipboard and revoke controls, or a "Create share link" button.
 *
 * Consumed by the Settings tab of app/(app)/trip/[id]/index.tsx.
 *
 * State strategy:
 *   The backend only provides useCreateShareLink (returns token on create) and
 *   useRevokeShareLink. There is no "get current active token" query because tokens
 *   are single-reveal for security (the owner sees the token once on creation).
 *   We persist the token in component state after a successful create, and clear
 *   it on revoke. The token also resets if the component unmounts (user navigates
 *   away), consistent with single-reveal security intent.
 *   REVIEWER: If the backend adds a useActiveShareLink query later, swap in that
 *   hook here for persistence across unmounts.
 *
 * URL shape:
 *   Web:    window.location.origin + '/share/' + token  (always has an origin)
 *   Native: EXPO_PUBLIC_APP_URL env var + '/share/' + token  (preferred — opens in browser)
 *           Falls back to 'tripvisor://share/<token>' when EXPO_PUBLIC_APP_URL is unset.
 *           The deep-link fallback works on-device but recipients without the app will see
 *           an error. Set EXPO_PUBLIC_APP_URL in .env for a shareable public HTTPS URL.
 */
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { useTheme } from '@/theme';
import { copyToClipboard } from '@/lib/clipboard';
import { useCreateShareLink, useRevokeShareLink } from '@/api/share';

interface ShareLinkCardProps {
  tripId: string;
}

/**
 * Build the canonical URL for a share token.
 *
 * Returns { url, usingDeepLink } where usingDeepLink=true signals that
 * EXPO_PUBLIC_APP_URL was not configured and the deep-link scheme was used as a
 * fallback. The caller should surface a warning when usingDeepLink is true.
 */
function buildShareUrl(token: string): { url: string; usingDeepLink: boolean } {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return { url: `${window.location.origin}/share/${token}`, usingDeepLink: false };
  }
  // Native: prefer EXPO_PUBLIC_APP_URL (set in .env / EAS env vars for production).
  const appUrl =
    typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_APP_URL?.trim() : undefined;
  if (appUrl) {
    return { url: `${appUrl}/share/${token}`, usingDeepLink: false };
  }
  // Fallback: deep-link scheme — works when the app is installed on the recipient's device,
  // but won't open in a browser. Show a warning so the developer knows to set EXPO_PUBLIC_APP_URL.
  return { url: `tripvisor://share/${token}`, usingDeepLink: true };
}

export function ShareLinkCard({ tripId }: ShareLinkCardProps) {
  const t = useTheme();

  // Token lives here after a successful create and is cleared on revoke.
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createLink = useCreateShareLink(tripId);
  const revokeLink = useRevokeShareLink(tripId);

  const shareUrlResult = token ? buildShareUrl(token) : null;
  const shareUrl = shareUrlResult?.url ?? null;
  const usingDeepLink = shareUrlResult?.usingDeepLink ?? false;

  async function handleCreate() {
    const result = await createLink.mutateAsync();
    setToken(result.token);
  }

  async function handleRevoke() {
    await revokeLink.mutateAsync({ token: token ?? undefined });
    setToken(null);
  }

  async function handleCopy() {
    if (!shareUrl) return;
    const ok = await copyToClipboard(shareUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  return (
    <View
      style={[
        styles.card,
        {
          borderColor: t.colors.border,
          borderRadius: t.radius.md,
          backgroundColor: t.colors.bgElevated,
          padding: t.spacing.lg,
          gap: t.spacing.md,
        },
      ]}
      accessible
      accessibilityLabel="Share link"
    >
      {shareUrl ? (
        <>
          {/* URL display */}
          <View
            style={[
              styles.urlBox,
              {
                borderColor: t.colors.border,
                borderRadius: t.radius.sm,
                backgroundColor: t.colors.bg,
                padding: t.spacing.sm,
              },
            ]}
            accessible
            accessibilityLabel={`Share URL: ${shareUrl}`}
          >
            <Text
              style={[t.typography.caption, { color: t.colors.textMuted }]}
              numberOfLines={2}
              selectable
            >
              {shareUrl}
            </Text>
          </View>
          {/* Deep-link fallback warning — only shown when EXPO_PUBLIC_APP_URL is unset on native */}
          {usingDeepLink ? (
            <Text
              style={[t.typography.caption, { color: t.colors.textMuted }]}
              accessibilityLiveRegion="polite"
            >
              Deep-link URL only — set EXPO_PUBLIC_APP_URL in .env for a public web URL.
            </Text>
          ) : null}

          {/* Copy + Revoke */}
          <View style={{ gap: t.spacing.sm }}>
            <Button
              label={copied ? 'Copied!' : 'Copy link'}
              variant="secondary"
              onPress={handleCopy}
              disabled={copied}
              accessibilityLabel={copied ? 'Link copied to clipboard' : 'Copy share link to clipboard'}
            />
            <Button
              label="Revoke link"
              variant="danger"
              onPress={handleRevoke}
              loading={revokeLink.isPending}
              accessibilityLabel="Revoke share link — anyone with the link will lose access"
            />
          </View>

          {revokeLink.isError ? (
            <Text
              style={[t.typography.caption, { color: t.colors.danger }]}
              accessibilityLiveRegion="polite"
            >
              Could not revoke link — try again.
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
            Anyone with the link can view your itinerary (read-only). No sign-in required.
          </Text>
          <Button
            label="Create share link"
            variant="secondary"
            onPress={handleCreate}
            loading={createLink.isPending}
            accessibilityLabel="Create a read-only share link for this trip"
          />
          {createLink.isError ? (
            <Text
              style={[t.typography.caption, { color: t.colors.danger }]}
              accessibilityLiveRegion="polite"
            >
              Could not create link — try again.
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  urlBox: { borderWidth: 1 },
});
