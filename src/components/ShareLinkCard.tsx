/**
 * ShareLinkCard — the trip's two sharing options:
 *
 * 1. Public link — "Anyone with the link can view" (anonymous, token-based,
 *    read-only). Controls: create → Share (native share sheet; on web
 *    `navigator.share` with a clipboard fallback) / Copy / Revoke (confirmed).
 * 2. Invite collaborator — "Invite a specific person by email". Navigates to
 *    /trip/[id]/collaborators, where invite links are shared the same way.
 *
 * URL shape is built by the platform-split `buildAppUrl` helper
 * (src/components/share/shareSheet.{web,native}.ts) so this shared file
 * never touches `window`:
 *   Web:    <page origin>/share/<token>
 *   Native: EXPO_PUBLIC_APP_URL/share/<token>, else https://tripvisor.pages.dev/share/<token>
 *           (deep link only — a warning is shown so the dev sets the env var).
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from './Button';
import { Icon } from './Icon';
import { useTheme } from '@/theme';
import { copyToClipboard } from '@/lib/clipboard';
import { confirmDestructive } from '@/lib/confirm';
import { useCreateShareLink, useRevokeShareLink } from '@/api/share';
import { buildAppUrl, useShareAction } from './share';

interface ShareLinkCardProps {
  tripId: string;
  /** Used in the share-sheet subject/message. Optional for older callers. */
  tripTitle?: string;
}

export function ShareLinkCard({ tripId, tripTitle }: ShareLinkCardProps) {
  const t = useTheme();
  const router = useRouter();

  // Token lives here after a successful create and is cleared on revoke.
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { share, sharing, feedback } = useShareAction();

  const createLink = useCreateShareLink(tripId);
  const revokeLink = useRevokeShareLink(tripId);

  const shareUrlResult = token ? buildAppUrl(`share/${token}`) : null;
  const shareUrl = shareUrlResult?.url ?? null;
  const title = tripTitle?.trim() || 'my trip';

  async function handleCreate() {
    try {
      const result = await createLink.mutateAsync();
      setToken(result.token);
    } catch {
      // Surfaced via createLink.isError below.
    }
  }

  async function handleRevoke() {
    const ok = await confirmDestructive({
      title: 'Revoke public link?',
      message: 'Anyone who has this link will immediately lose access. You can create a new link later.',
      confirmLabel: 'Revoke',
    });
    if (!ok) return;
    try {
      await revokeLink.mutateAsync({ token: token ?? undefined });
      setToken(null);
    } catch {
      // Surfaced via revokeLink.isError below.
    }
  }

  async function handleCopy() {
    if (!shareUrl) return;
    const ok = await copyToClipboard(shareUrl);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  function handleShare() {
    if (!shareUrl) return;
    void share({
      url: shareUrl,
      title: `${title} · Tripvisor`,
      message: `Take a look at ${title} on Tripvisor — read-only, no sign-in needed.`,
    });
  }

  const cardStyle = [
    styles.card,
    {
      borderColor: t.colors.border,
      borderRadius: t.radius.xl,
      backgroundColor: t.colors.cardBgSolid,
      padding: t.spacing.lg,
      gap: t.spacing.md,
      ...t.shadows.sm(t.colors.shadowColor),
    },
  ];

  return (
    <View style={{ gap: t.spacing.lg }}>
      {/* ── Section 1: Public link ──────────────────────────────────────── */}
      <View style={cardStyle} accessibilityLabel="Public link sharing">
        <SectionLabel icon="share-2" title="Public link" subtitle="Anyone with the link can view" />

        {shareUrl ? (
          <>
            <View
              style={[
                styles.urlBox,
                {
                  borderColor: t.colors.border,
                  borderRadius: t.radius.md,
                  backgroundColor: t.colors.bgMuted,
                  padding: t.spacing.md,
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

            <View style={{ gap: t.spacing.sm }}>
              <Button
                label="Share link"
                onPress={handleShare}
                loading={sharing}
                leftIcon={<Icon name="share-2" size={18} color={t.colors.primaryText} />}
                accessibilityLabel="Share the public trip link"
              />
              <View style={[styles.row, { gap: t.spacing.sm }]}>
                <View style={styles.flex}>
                  <Button
                    label={copied ? 'Copied!' : 'Copy link'}
                    variant="secondary"
                    onPress={handleCopy}
                    disabled={copied}
                    accessibilityLabel={copied ? 'Link copied to clipboard' : 'Copy share link to clipboard'}
                  />
                </View>
                <View style={styles.flex}>
                  <Button
                    label="Revoke"
                    variant="danger"
                    onPress={handleRevoke}
                    loading={revokeLink.isPending}
                    accessibilityLabel="Revoke share link — anyone with the link will lose access"
                  />
                </View>
              </View>
            </View>

            {feedback ? (
              <Text
                style={[t.typography.caption, { color: t.colors.textMuted }]}
                accessibilityLiveRegion="polite"
              >
                {feedback}
              </Text>
            ) : null}
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
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              Anyone with the link can view your itinerary — read-only, no sign-in required.
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

      {/* ── Section 2: Invite collaborator ──────────────────────────────── */}
      <View style={cardStyle} accessibilityLabel="Invite a specific collaborator by email">
        <SectionLabel icon="users" title="Invite collaborator" subtitle="Invite a specific person by email" />
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
          Collaborators sign in to access the trip. Assign them viewer or editor access.
        </Text>
        <Button
          label="Manage collaborators"
          variant="secondary"
          onPress={() => router.push(`/trip/${tripId}/collaborators` as never)}
          accessibilityLabel="Go to manage collaborators screen to invite someone by email"
        />
      </View>
    </View>
  );
}

function SectionLabel({
  icon,
  title,
  subtitle,
}: {
  icon: 'share-2' | 'users';
  title: string;
  subtitle: string;
}) {
  const t = useTheme();
  return (
    <View style={[styles.row, { gap: t.spacing.md, alignItems: 'flex-start' }]}>
      <View
        style={[
          styles.iconBadge,
          { backgroundColor: t.colors.gradientSubtle, borderRadius: t.radius.pill },
        ]}
      >
        <Icon name={icon} size={18} color={t.colors.primary} />
      </View>
      <View style={styles.flex}>
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} accessibilityRole="header">
          {title}
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  urlBox: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  iconBadge: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
