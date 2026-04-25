/**
 * /invite/[token] — Collaborator invite-accept screen.
 *
 * Flow:
 *   1. User follows an email link to this route.
 *   2. If not authenticated → redirect to /login?redirect=/invite/<token>.
 *   3. Screen shows trip info preview + "Accept" / "Decline" buttons.
 *      DO NOT auto-accept — the user must explicitly tap Accept.
 *   4. On Accept → navigate to /trip/<tripId>.
 *   5. On Decline → navigate to /trips.
 *
 * Error handling (CollaboratorError codes):
 *   - email_mismatch   → "This invite was sent to a different email address."
 *   - invite_expired   → "This invite has expired."
 *   - invite_not_found → "Invite not found or already used."
 *   - already_accepted → "You've already accepted this invite."
 *   - invite_revoked   → "This invite was revoked."
 *   - (default)        → generic message.
 *
 * Desktop: max-width 560px centred (matches add-place 720px pattern, slightly
 * narrower because this is a single-action form, not a search flow).
 */
import { useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useSession } from '@/api/auth';
import {
  useAcceptCollaboratorInvite,
  useDeclineCollaboratorInvite,
  CollaboratorError,
} from '@/api/trip-collaborators';

const INVITE_MAX_WIDTH = 560;

export default function InviteAcceptScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();
  const t = useTheme();
  const bp = useBreakpoint();
  const isDesktop = bp === 'desktop';

  const { data: session, isLoading: sessionLoading } = useSession();

  const acceptInvite = useAcceptCollaboratorInvite(token);
  const declineInvite = useDeclineCollaboratorInvite(token);

  const [actionError, setActionError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Redirect unauthenticated users to login with a return URL.
  if (!sessionLoading && !session) {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const returnPath = `/invite/${token ?? ''}`;
      router.replace(`/login?redirect=${encodeURIComponent(returnPath)}` as never);
    } else {
      router.replace('/login' as never);
    }
    return null;
  }

  if (sessionLoading) {
    return (
      <Screen>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </Screen>
    );
  }

  async function handleAccept() {
    setActionError(null);
    try {
      const result = await acceptInvite.mutateAsync();
      setDone(true);
      router.replace(`/trip/${result.tripId}` as never);
    } catch (err) {
      setActionError(formatCollaboratorError(err));
    }
  }

  async function handleDecline() {
    setActionError(null);
    try {
      await declineInvite.mutateAsync();
      router.replace('/trips' as never);
    } catch (err) {
      setActionError(formatCollaboratorError(err));
    }
  }

  const isPending = acceptInvite.isPending || declineInvite.isPending;

  return (
    <Screen padded={false}>
      <View
        style={[
          styles.container,
          isDesktop && {
            maxWidth: INVITE_MAX_WIDTH,
            alignSelf: 'center',
            width: '100%',
          },
          { padding: t.spacing.lg, gap: t.spacing.lg },
        ]}
      >
        <BackButton onPress={() => router.replace('/trips' as never)} label="Trips" />

        {/* Header */}
        <View style={{ gap: t.spacing.sm }}>
          <Text
            style={[t.typography.title, { color: t.colors.text }]}
            accessibilityRole="header"
            aria-level={1}
          >
            Trip invitation
          </Text>
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
            You've been invited to collaborate on a trip. Review and choose to accept or decline.
          </Text>
        </View>

        {/* Token summary card */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: t.colors.bgElevated,
              borderColor: t.colors.border,
              borderRadius: t.radius.lg,
              padding: t.spacing.lg,
              gap: t.spacing.sm,
              ...t.shadows.sm(t.colors.shadowColor),
            },
          ]}
        >
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>
            Invitation token
          </Text>
          <Text
            style={[t.typography.caption, { color: t.colors.textMuted }]}
            numberOfLines={1}
            selectable
          >
            {token ?? '—'}
          </Text>
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            Accepting gives you access to the shared trip. The trip owner chose which role you'll have (viewer or editor).
          </Text>
        </View>

        {/* Error display */}
        {actionError ? (
          <View
            style={[
              styles.errorBox,
              {
                backgroundColor: t.colors.dangerLight,
                borderColor: t.colors.danger,
                borderRadius: t.radius.md,
                padding: t.spacing.md,
              },
            ]}
            accessibilityRole="alert"
          >
            <Text style={[t.typography.body, { color: t.colors.danger }]}>
              {actionError}
            </Text>
          </View>
        ) : null}

        {/* Action buttons */}
        {!done ? (
          <View style={{ gap: t.spacing.sm }}>
            <Button
              label="Accept invitation"
              onPress={handleAccept}
              loading={acceptInvite.isPending}
              disabled={isPending}
              accessibilityLabel="Accept trip collaboration invitation"
            />
            <Button
              label="Decline"
              variant="secondary"
              onPress={handleDecline}
              loading={declineInvite.isPending}
              disabled={isPending}
              accessibilityLabel="Decline trip collaboration invitation"
            />
          </View>
        ) : (
          <Text style={[t.typography.body, { color: t.colors.success }]}>
            Accepted! Redirecting to the trip…
          </Text>
        )}
      </View>
    </Screen>
  );
}

/**
 * Maps CollaboratorError codes to user-facing messages.
 * Falls back to the raw error message if it's not a CollaboratorError.
 */
function formatCollaboratorError(err: unknown): string {
  if (err instanceof CollaboratorError) {
    switch (err.code) {
      case 'email_mismatch':
        return 'This invite was sent to a different email address. Please sign in with the account that received the invite.';
      case 'invite_expired':
        return 'This invite has expired. Ask the trip owner to send a new one.';
      case 'invite_not_found':
        return 'Invite not found or already used.';
      case 'already_accepted':
        return "You've already accepted this invitation.";
      case 'invite_revoked':
        return 'This invite was revoked by the trip owner.';
      default:
        return err.message || 'Something went wrong. Please try again.';
    }
  }
  if (err instanceof Error) return err.message;
  return 'Something went wrong. Please try again.';
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  card: { borderWidth: 1 },
  errorBox: { borderWidth: 1 },
});
