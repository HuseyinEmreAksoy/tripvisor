/**
 * ShareLinkCard — the trip's two sharing options:
 *
 * 1. Public link — "Anyone with the link can view" (anonymous, token-based,
 *    read-only). The link is On (URL + Share / Copy / Turn off) or Off
 *    (Create). Below it, what the link shows (M5 Y3.5): itinerary (on by
 *    default), the expense summary and the owner's memories (both off by
 *    default). With a live link a flip is saved right away
 *    (`useUpdateShareSettings`, optimistic); without one the choices are a
 *    draft passed to `useCreateShareLink().mutate({ settings })`.
 * 2. Invite collaborator — "Invite a specific person by email". Navigates to
 *    /trip/[id]/collaborators, where invite links are shared the same way.
 *
 * Owner-only: every `share-trip` owner op rejects collaborators with 403
 * `not_owner` (security audit #5). Callers render this card for the owner
 * only (`enabled` holds the owner reads otherwise); a stale role still gets
 * a clear message instead of "try again".
 *
 * The live link comes from the server (`useCurrentShareLink`), so it shows
 * again after a reload or on another device. `no_active_link` (the link was
 * turned off elsewhere) drops back to the Off state with an explanation.
 *
 * URL shape is built by the platform-split `buildAppUrl` helper
 * (src/components/share/shareSheet.{web,native}.ts) so this shared file
 * never touches `window`:
 *   Web:    <page origin>/share/<token>
 *   Native: EXPO_PUBLIC_APP_URL/share/<token>, else https://tripvisor.pages.dev/share/<token>
 *           (always an https link anyone can open — never the tripvisor:// scheme).
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button } from './Button';
import { Icon } from './Icon';
import { surfaceStyle, useTheme } from '@/theme';
import { copyToClipboard } from '@/lib/clipboard';
import { confirmDestructive } from '@/lib/confirm';
import {
  DEFAULT_SHARE_SETTINGS,
  ShareLinkError,
  useCreateShareLink,
  useCurrentShareLink,
  useRevokeShareLink,
  useTripShareSettings,
  useUpdateShareSettings,
  type ShareSettings,
} from '@/api/share';
import { useT } from '@/i18n';
import { buildAppUrl, useShareAction } from './share';
import { ShareToggles, type ShareToggleKey } from './share/ShareToggles';

type ShareErrorKey =
  | 'link.ownerOnly'
  | 'link.createFailed'
  | 'link.revokeFailed'
  | 'link.updateFailed'
  | 'link.noActiveLink';

function hasCode(err: unknown, code: string): boolean {
  return err instanceof ShareLinkError && err.code === code;
}

/** The `share` key for a failed owner op (translated at render). */
function shareErrorKey(err: unknown, fallback: ShareErrorKey): ShareErrorKey {
  if (hasCode(err, 'not_owner')) return 'link.ownerOnly';
  if (hasCode(err, 'no_active_link')) return 'link.noActiveLink';
  return fallback;
}

interface ShareLinkCardProps {
  tripId: string;
  /** Used in the share-sheet subject/message. Optional for older callers. */
  tripTitle?: string;
  /** Owner reads are mounted only when true (default). Pass `isOwner`. */
  enabled?: boolean;
}

export function ShareLinkCard({ tripId, tripTitle, enabled = true }: ShareLinkCardProps) {
  const t = useTheme();
  const { t: tx } = useT('share');
  const router = useRouter();

  // `current` = token + toggles; `liveSettings` reads the same query (no extra request).
  const current = useCurrentShareLink(tripId, { enabled });
  const liveSettings = useTripShareSettings(tripId, { enabled });
  // `createdToken` only bridges the moment between create and the cache update.
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const token = current.data?.token ?? createdToken;
  const loadingCurrent = current.isLoading && !createdToken;
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState<ShareSettings>({ ...DEFAULT_SHARE_SETTINGS });
  // Set when a toggle flip found no live link (turned off on another device).
  const [linkLost, setLinkLost] = useState(false);
  const { share, sharing, feedback } = useShareAction();

  const createLink = useCreateShareLink(tripId);
  const revokeLink = useRevokeShareLink(tripId);
  const updateSettings = useUpdateShareSettings(tripId);
  // Retrying can't succeed for a non-owner, so the controls go inert.
  const forbidden = hasCode(createLink.error, 'not_owner') || hasCode(updateSettings.error, 'not_owner');

  const shareUrl = token ? buildAppUrl(`share/${token}`).url : null;
  const isOn = Boolean(shareUrl);
  const settings: ShareSettings = isOn ? (liveSettings.data ?? current.data?.settings ?? draft) : draft;
  const title = tripTitle?.trim() || tx('link.untitledTrip');

  function handleToggle(key: ShareToggleKey, value: boolean) {
    if (!isOn) {
      setDraft((d) => ({ ...d, [key]: value }));
      return;
    }
    // Start the next draft from what the live link shows.
    setDraft({ ...settings, [key]: value });
    updateSettings.mutate(
      { [key]: value },
      {
        onError: (err) => {
          if (hasCode(err, 'no_active_link')) {
            setLinkLost(true);
            setCreatedToken(null);
            void current.refetch();
          }
        },
      },
    );
  }

  async function handleCreate() {
    try {
      setLinkLost(false);
      updateSettings.reset();
      const result = await createLink.mutateAsync({ settings: draft });
      setCreatedToken(result.token);
    } catch {
      // Surfaced via createLink.isError below.
    }
  }

  async function handleRevoke() {
    const ok = await confirmDestructive({
      title: tx('link.revokeConfirm.title'),
      message: tx('link.revokeConfirm.message'),
      confirmLabel: tx('link.revokeConfirm.confirm'),
    });
    if (!ok) return;
    try {
      // No token = revoke EVERY active link of the trip: a link created on
      // another device or before a reload must not stay public.
      await revokeLink.mutateAsync();
      setDraft({ ...settings });
      setCreatedToken(null);
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
      title: tx('link.shareTitle', { title }),
      message: tx('link.shareMessage', { title }),
    });
  }

  const cardStyle = [surfaceStyle(t, 'raised'), { padding: t.spacing.lg, gap: t.spacing.md }];
  const statusLabel = isOn ? tx('link.statusOn') : tx('link.statusOff');
  const updateError =
    updateSettings.isError && !linkLost ? tx(shareErrorKey(updateSettings.error, 'link.updateFailed')) : null;

  return (
    <View style={{ gap: t.spacing.lg }}>
      {/* ── Section 1: Public link ──────────────────────────────────────── */}
      <View style={cardStyle} accessibilityLabel={tx('link.sectionA11y')}>
        <SectionLabel
          icon="share-2"
          title={tx('link.title')}
          subtitle={tx('link.subtitle')}
          status={loadingCurrent ? null : { label: statusLabel, on: isOn, a11y: tx('link.statusA11y', { status: statusLabel }) }}
        />

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
              accessibilityLabel={tx('link.urlA11y', { url: shareUrl })}
            >
              <Text style={[t.typography.caption, { color: t.colors.textMuted }]} numberOfLines={2} selectable>
                {shareUrl}
              </Text>
            </View>

            <View style={{ gap: t.spacing.sm }}>
              <Button
                label={tx('link.share')}
                onPress={handleShare}
                loading={sharing}
                leftIcon={<Icon name="share-2" size={18} color={t.colors.primaryText} />}
                accessibilityLabel={tx('link.shareA11y')}
              />
              <View style={[styles.row, { gap: t.spacing.sm }]}>
                <View style={styles.flex}>
                  <Button
                    label={copied ? tx('link.copied') : tx('link.copy')}
                    variant="secondary"
                    onPress={handleCopy}
                    disabled={copied}
                    accessibilityLabel={copied ? tx('link.copiedA11y') : tx('link.copyA11y')}
                  />
                </View>
                <View style={styles.flex}>
                  <Button
                    label={tx('link.revoke')}
                    variant="danger"
                    onPress={handleRevoke}
                    loading={revokeLink.isPending}
                    accessibilityLabel={tx('link.revokeA11y')}
                  />
                </View>
              </View>
            </View>

            {feedback ? <Note text={feedback} /> : null}
            {revokeLink.isError ? <Note danger text={tx(shareErrorKey(revokeLink.error, 'link.revokeFailed'))} /> : null}
          </>
        ) : (
          <>
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              {loadingCurrent ? tx('link.checking') : tx('link.offBody')}
            </Text>
            {linkLost ? <Note danger text={tx('link.noActiveLink')} /> : null}
          </>
        )}

        <ShareToggles
          settings={settings}
          onChange={handleToggle}
          live={isOn}
          disabled={forbidden || loadingCurrent}
        />
        {updateError ? <Note danger text={updateError} /> : null}

        {!isOn ? (
          <>
            <Button
              label={tx('link.create')}
              onPress={handleCreate}
              loading={createLink.isPending || loadingCurrent}
              disabled={forbidden || loadingCurrent}
              accessibilityLabel={tx('link.createA11y')}
            />
            {createLink.isError ? <Note danger text={tx(shareErrorKey(createLink.error, 'link.createFailed'))} /> : null}
          </>
        ) : null}
      </View>

      {/* ── Section 2: Invite collaborator ──────────────────────────────── */}
      <View style={cardStyle} accessibilityLabel={tx('invite.sectionA11y')}>
        <SectionLabel icon="users" title={tx('invite.title')} subtitle={tx('invite.subtitle')} status={null} />
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{tx('invite.body')}</Text>
        <Button
          label={tx('invite.manage')}
          variant="secondary"
          onPress={() => router.push(`/trip/${tripId}/collaborators` as never)}
          accessibilityLabel={tx('invite.manageA11y')}
        />
      </View>
    </View>
  );
}

function Note({ text, danger = false }: { text: string; danger?: boolean }) {
  const t = useTheme();
  return (
    <Text
      style={[t.typography.caption, { color: danger ? t.colors.danger : t.colors.textMuted }]}
      accessibilityLiveRegion="polite"
      accessibilityRole={danger ? 'alert' : undefined}
    >
      {text}
    </Text>
  );
}

function SectionLabel({
  icon,
  title,
  subtitle,
  status,
}: {
  icon: 'share-2' | 'users';
  title: string;
  subtitle: string;
  status: { label: string; on: boolean; a11y: string } | null;
}) {
  const t = useTheme();
  return (
    <View style={[styles.row, { gap: t.spacing.md, alignItems: 'flex-start' }]}>
      <View style={[styles.iconBadge, { backgroundColor: t.colors.gradientSubtle, borderRadius: t.radius.pill }]}>
        <Icon name={icon} size={18} color={t.colors.primaryInk} />
      </View>
      <View style={styles.flex}>
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} accessibilityRole="header">
          {title}
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{subtitle}</Text>
      </View>
      {status ? (
        <View
          accessible
          accessibilityLabel={status.a11y}
          style={[
            styles.status,
            {
              borderRadius: t.radius.pill,
              paddingHorizontal: t.spacing.sm,
              backgroundColor: status.on ? t.colors.successLight : t.colors.bgMuted,
            },
          ]}
        >
          <Text style={[t.typography.small, { color: status.on ? t.colors.success : t.colors.textMuted, fontWeight: '700' }]}>
            {status.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  urlBox: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  iconBadge: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  status: { minHeight: 24, justifyContent: 'center' },
});
