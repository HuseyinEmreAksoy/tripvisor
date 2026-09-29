/**
 * /trip/[id]/collaborators — who can see and edit this trip.
 *
 * Phone-first layout (X3.3):
 *   header (back · title · trip name) → full-width "Invite someone" (owner)
 *   → People (accepted; owner gets inline Viewer/Editor role chips + Remove)
 *   → Pending invites (sent-age + expiry, Cancel) → Past invites (read-only).
 * Revoke / cancel are confirmed first (they can't be undone — the person has
 * to be re-invited). Invite links go through the native share sheet from the
 * InviteSheet success step.
 *
 * Resend: not offered — `manage-collaborators` has no resend action and the
 * pending row doesn't expose its token (re-inviting returns `already_invited`).
 *
 * Desktop: max-width 720px centred.
 */
import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeBack } from '@/hooks/useSafeBack';
import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { notFoundArt, peopleArt } from '@/components/emptyStates';
import { useT } from '@/i18n';
import { Icon } from '@/components/Icon';
import { Screen } from '@/components/Screen';
import { CollaboratorRow } from '@/components/collaborators/CollaboratorRow';
import { InviteSheet } from '@/components/collaborators/InviteSheet';
import { groupCollaborators } from '@/components/collaborators/collaboratorModel';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { confirmDestructive } from '@/lib/confirm';
import { useSession } from '@/api/auth';
import { useTrip } from '@/api/trips';
import {
  useTripCollaborators,
  useInviteCollaborator,
  useRevokeCollaborator,
  useUpdateCollaborator,
  CollaboratorError,
} from '@/api/trip-collaborators';
import type { TripCollaborator, TripCollaboratorRole } from '@/api/types';

const COLLAB_MAX_WIDTH = 720;

function roleUpdateErrorMessage(err: unknown): string {
  if (err instanceof CollaboratorError) {
    switch (err.code) {
      case 'not_owner':
        return 'Only the trip owner can change collaborator roles.';
      case 'collaborator_not_found':
        return 'This collaborator no longer exists.';
      case 'invalid_input':
        return 'Invalid role.';
      default:
        break;
    }
  }
  return "Couldn't update role. Try again.";
}

export default function CollaboratorsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tripId = id ?? '';
  const goBack = useSafeBack(`/trip/${tripId}`);
  const t = useTheme();
  const { t: tx } = useT('collab');
  const isDesktop = useBreakpoint() === 'desktop';

  const { data: session } = useSession();
  const { data: trip, isLoading: tripLoading } = useTrip(id);
  const { data: collaborators = [], isLoading: collabLoading, error: collabError, refetch } =
    useTripCollaborators(id);
  const inviteCollaborator = useInviteCollaborator();
  const revokeCollaborator = useRevokeCollaborator();
  const updateCollaborator = useUpdateCollaborator();

  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  if (tripLoading || collabLoading) {
    return (
      <Screen>
        <ActivityIndicator size="large" color={t.colors.primary} accessibilityLabel="Loading collaborators" />
      </Screen>
    );
  }

  if (!trip) {
    return (
      <Screen>
        <BackButton onPress={goBack} label="Trip" />
        <EmptyState
          illustration={notFoundArt}
          title={tx('screen.notFound.title')}
          body={tx('screen.notFound.body')}
        />
      </Screen>
    );
  }

  const isOwner = Boolean(session?.user && trip.user_id === session.user.id);
  const { people, pending, past } = groupCollaborators(collaborators);
  const revokingId = revokeCollaborator.isPending ? revokeCollaborator.variables?.collaboratorId : undefined;
  const updatingId = updateCollaborator.isPending ? updateCollaborator.variables?.collaboratorId : undefined;

  function setRowError(collabId: string, message: string) {
    setRowErrors((prev) => ({ ...prev, [collabId]: message }));
  }

  function handleRoleChange(collab: TripCollaborator, role: TripCollaboratorRole) {
    if (role === collab.role) return;
    setRowError(collab.id, '');
    updateCollaborator.mutate(
      { collaboratorId: collab.id, tripId, role },
      { onError: (err) => setRowError(collab.id, roleUpdateErrorMessage(err)) },
    );
  }

  async function handleRevoke(collab: TripCollaborator) {
    const isPending = collab.status === 'pending';
    const ok = await confirmDestructive({
      title: isPending ? 'Cancel invite?' : 'Remove collaborator?',
      message: isPending
        ? `The invite link sent to ${collab.invitee_email} will stop working.`
        : `${collab.invitee_email} will lose access to this trip. You can invite them again later.`,
      confirmLabel: isPending ? 'Cancel invite' : 'Remove',
    });
    if (!ok) return;
    setRowError(collab.id, '');
    revokeCollaborator.mutate(
      { collaboratorId: collab.id, tripId },
      { onError: () => setRowError(collab.id, "Couldn't revoke. Check your connection and try again.") },
    );
  }

  const renderManaged = (collab: TripCollaborator) => (
    <CollaboratorRow
      key={collab.id}
      collab={collab}
      canManage={isOwner}
      onRevoke={() => void handleRevoke(collab)}
      revoking={revokingId === collab.id}
      onRoleChange={(role) => handleRoleChange(collab, role)}
      updatingRole={updatingId === collab.id}
      roleError={rowErrors[collab.id] || null}
    />
  );

  const nobodyYet = people.length === 0 && pending.length === 0;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={[
          { padding: t.spacing.lg, gap: t.spacing.xl, paddingBottom: t.spacing.huge },
          isDesktop && styles.desktop,
        ]}
      >
        <View style={{ gap: t.spacing.md }}>
          <BackButton onPress={goBack} label="Trip" />
          <View style={{ gap: t.spacing.xs }}>
            <Text style={[t.typography.overline, { color: t.colors.primaryInk }]} numberOfLines={1}>
              {trip.title}
            </Text>
            <Text style={[t.typography.title, { color: t.colors.text }]} accessibilityRole="header" aria-level={1}>
              Collaborators
            </Text>
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              {isOwner
                ? 'Invite friends to plan together. Editors can change the plan; viewers can follow along.'
                : 'People planning this trip together.'}
            </Text>
          </View>
          {isOwner ? (
            <Button
              label="Invite someone"
              onPress={() => setInviteSheetOpen(true)}
              leftIcon={<Icon name="plus" size={18} color={t.colors.primaryText} />}
              accessibilityLabel="Invite a collaborator by email"
            />
          ) : null}
        </View>

        {collabError ? (
          <View
            style={[
              styles.errorBox,
              { backgroundColor: t.colors.dangerLight, borderColor: t.colors.danger, borderRadius: t.radius.md, padding: t.spacing.md, gap: t.spacing.sm },
            ]}
            accessibilityRole="alert"
          >
            <Text style={[t.typography.body, { color: t.colors.danger }]}>Could not load collaborators.</Text>
            <Button label="Try again" variant="secondary" fullWidth={false} onPress={() => void refetch()} />
          </View>
        ) : null}

        <Section label="People" count={people.length + (isOwner ? 1 : 0)}>
          {isOwner ? <OwnerRow email={session?.user?.email ?? 'You'} /> : null}
          {people.map(renderManaged)}
          {!isOwner && people.length === 0 ? (
            <Text style={[t.typography.body, { color: t.colors.textMuted }]}>No one else has joined yet.</Text>
          ) : null}
        </Section>

        {pending.length > 0 ? (
          <Section label="Pending invites" count={pending.length}>
            {pending.map(renderManaged)}
          </Section>
        ) : null}

        {isOwner && nobodyYet && !collabError ? (
          <EmptyState
            illustration={peopleArt}
            title={tx('screen.empty.title')}
            body={tx('screen.empty.body')}
            ctaLabel={tx('screen.empty.cta')}
            onPress={() => setInviteSheetOpen(true)}
          />
        ) : null}

        {past.length > 0 ? (
          <Section label="Past invites" count={past.length}>
            {past.map((collab) => (
              <CollaboratorRow key={collab.id} collab={collab} canManage={false} />
            ))}
          </Section>
        ) : null}
      </ScrollView>

      <InviteSheet
        tripId={tripId}
        tripTitle={trip.title}
        visible={inviteSheetOpen}
        onClose={() => setInviteSheetOpen(false)}
        inviteMutation={inviteCollaborator}
      />
    </Screen>
  );
}

function Section({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text style={[t.typography.overline, { color: t.colors.textMuted }]} accessibilityRole="header" aria-level={2}>
        {label} · {count}
      </Text>
      {children}
    </View>
  );
}

function OwnerRow({ email }: { email: string }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.ownerRow,
        { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.lg, padding: t.spacing.md, gap: t.spacing.md },
      ]}
      accessible
      accessibilityLabel={`You, ${email}, owner`}
    >
      <View style={[styles.avatar, { backgroundColor: t.colors.primary, borderRadius: t.radius.pill }]}>
        <Icon name="circle-user" size={22} color={t.colors.primaryText} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>You</Text>
        <Text style={[t.typography.small, { color: t.colors.textMuted }]} numberOfLines={1}>
          {email}
        </Text>
      </View>
      <Text style={[t.typography.caption, { color: t.colors.primaryInk, fontWeight: '700' }]}>Owner</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  desktop: { maxWidth: COLLAB_MAX_WIDTH, alignSelf: 'center', width: '100%' },
  errorBox: { borderWidth: 1 },
  ownerRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
