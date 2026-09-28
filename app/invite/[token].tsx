/**
 * /invite/[token] — Collaborator invite-accept screen.
 *
 * Flow:
 *   1. User follows an email link (or a shared invite link) to this route.
 *   2. If not authenticated → store /invite/<token> as the pending post-login
 *      redirect (src/lib/pendingRedirect.ts) and <Redirect> to /login.
 *   3. Screen explains the invite + "Accept" / "Decline" buttons.
 *      DO NOT auto-accept — the user must explicitly tap Accept.
 *   4. On Accept → navigate to /trip/<tripId>.
 *   5. On Decline → navigate to /trips.
 *
 * Error handling (CollaboratorError codes):
 *   - email_mismatch   → "This invite was sent to a different email address."
 *                        + "Use a different account" (sign out). The signed-out
 *                        branch below then stores the pending redirect and
 *                        sends the user to /login, so they land back here.
 *   - invite_expired   → "This invite has expired."
 *   - invite_not_found → "Invite not found or already used."
 *   - already_accepted → "You've already accepted this invite."
 *   - invite_revoked   → "This invite was revoked."
 *   - (default)        → generic message.
 *
 * Desktop: max-width 560px centred (single-action form).
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { setPendingRedirect } from '@/lib/pendingRedirect';
import { useSession, useSignOut } from '@/api/auth';
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
  const signOut = useSignOut();

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionErrorCode, setActionErrorCode] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Signed-out users: remember this invite as the post-login destination
  // (AsyncStorage survives the magic-link / OAuth round trip on every
  // platform), then send them to /login. The (auth) layout and the root
  // index consume it once a session exists.
  const needsLogin = !sessionLoading && !session;
  const [redirectStored, setRedirectStored] = useState(false);
  useEffect(() => {
    if (!needsLogin || !token) return;
    let cancelled = false;
    void setPendingRedirect(`/invite/${encodeURIComponent(token)}`).finally(() => {
      if (!cancelled) setRedirectStored(true);
    });
    return () => {
      cancelled = true;
    };
  }, [needsLogin, token]);

  if (needsLogin) {
    if (redirectStored || !token) return <Redirect href="/login" />;
    return (
      <Screen>
        <ActivityIndicator size="large" color={t.colors.primary} accessibilityLabel="Redirecting to sign in" />
      </Screen>
    );
  }

  if (sessionLoading) {
    return (
      <Screen>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </Screen>
    );
  }

  function showError(err: unknown) {
    setActionError(formatCollaboratorError(err));
    setActionErrorCode(err instanceof CollaboratorError ? err.code : null);
  }

  async function handleAccept() {
    setActionError(null);
    setActionErrorCode(null);
    try {
      const result = await acceptInvite.mutateAsync();
      setDone(true);
      router.replace(`/trip/${result.tripId}`);
    } catch (err) {
      showError(err);
    }
  }

  async function handleDecline() {
    setActionError(null);
    setActionErrorCode(null);
    try {
      await declineInvite.mutateAsync();
      router.replace('/trips');
    } catch (err) {
      showError(err);
    }
  }

  const isPending = acceptInvite.isPending || declineInvite.isPending;
  const signedInEmail = session?.user?.email ?? null;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          isDesktop && { maxWidth: INVITE_MAX_WIDTH, alignSelf: 'center', width: '100%' },
          { padding: t.spacing.lg, gap: t.spacing.xl },
        ]}
      >
        <BackButton onPress={() => router.replace('/trips')} label="Trips" />

        {/* Hero */}
        <View style={{ alignItems: 'center', gap: t.spacing.md, paddingTop: t.spacing.lg }}>
          <View style={[styles.heroIcon, { backgroundColor: t.colors.gradientSubtle, borderRadius: t.radius.pill }]}>
            <Icon name="users" size={32} color={t.colors.primary} />
          </View>
          <Text style={[t.typography.overline, { color: t.colors.primary }]}>Trip invitation</Text>
          <Text
            style={[t.typography.title, { color: t.colors.text, textAlign: 'center' }]}
            accessibilityRole="header"
            aria-level={1}
          >
            {"You're invited to plan a trip together"}
          </Text>
          <Text style={[t.typography.body, { color: t.colors.textMuted, textAlign: 'center' }]}>
            Accept to see the itinerary, map and budget. The trip owner chose whether you can edit (editor) or
            just follow along (viewer).
          </Text>
        </View>

        {/* What happens next */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: t.colors.cardBgSolid,
              borderColor: t.colors.border,
              borderRadius: t.radius.xl,
              padding: t.spacing.lg,
              gap: t.spacing.md,
              ...t.shadows.sm(t.colors.shadowColor),
            },
          ]}
        >
          <Point icon="map" text="The trip appears in your Trips list right away." />
          <Point icon="pencil" text="Editors can add places, notes and expenses; viewers can only look." />
          <Point icon="x" text="Declining just dismisses the invite. The owner can invite you again." />
          {signedInEmail ? (
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              Signed in as <Text style={{ color: t.colors.text, fontWeight: '600' }}>{signedInEmail}</Text>. The
              invite must have been sent to this address.
            </Text>
          ) : null}
        </View>

        {actionError ? (
          <View
            style={[
              styles.errorBox,
              {
                backgroundColor: t.colors.dangerLight,
                borderColor: t.colors.danger,
                borderRadius: t.radius.md,
                padding: t.spacing.md,
                gap: t.spacing.sm,
              },
            ]}
            accessibilityRole="alert"
          >
            <Text style={[t.typography.body, { color: t.colors.danger }]}>{actionError}</Text>
            {actionErrorCode === 'email_mismatch' ? (
              <Button
                label="Use a different account"
                variant="secondary"
                fullWidth={false}
                loading={signOut.isPending}
                onPress={() => signOut.mutate()}
                accessibilityLabel="Sign out and sign in with the account that received the invite"
              />
            ) : null}
          </View>
        ) : null}

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
              variant="ghost"
              onPress={handleDecline}
              loading={declineInvite.isPending}
              disabled={isPending}
              accessibilityLabel="Decline trip collaboration invitation"
            />
          </View>
        ) : (
          <Text
            style={[t.typography.body, { color: t.colors.success, textAlign: 'center' }]}
            accessibilityLiveRegion="polite"
          >
            Accepted! Opening the trip…
          </Text>
        )}
      </ScrollView>
    </Screen>
  );
}

function Point({ icon, text }: { icon: 'map' | 'pencil' | 'x'; text: string }) {
  const t = useTheme();
  return (
    <View style={[styles.point, { gap: t.spacing.md }]}>
      <Icon name={icon} size={18} color={t.colors.primary} />
      <Text style={[t.typography.body, { color: t.colors.text, flex: 1 }]}>{text}</Text>
    </View>
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
  container: { flexGrow: 1 },
  card: { borderWidth: 1 },
  errorBox: { borderWidth: 1 },
  heroIcon: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  point: { flexDirection: 'row', alignItems: 'flex-start' },
});
