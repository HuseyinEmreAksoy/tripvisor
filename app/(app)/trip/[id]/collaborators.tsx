/**
 * /trip/[id]/collaborators — Manage trip collaborators.
 *
 * Owner view:
 *   - Full list of all collaborators (any status).
 *   - Invite button → email + role form in a bottom sheet.
 *   - Revoke button per accepted/pending row.
 *   - Role toggle for accepted rows (owner-only): tap the role chip to open
 *     an inline selector; calls useUpdateCollaborator with optimistic update.
 *
 * Non-owner view:
 *   - Read-only list of collaborators visible to the caller under RLS
 *     (their own row, plus other accepted rows if RLS permits).
 *
 * Desktop: max-width 720px centred (matching add-place pattern).
 */
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { BackButton } from '@/components/BackButton';
import { Button } from '@/components/Button';
import { Screen } from '@/components/Screen';
import { BottomSheet } from '@/components';
import { SegmentedControl } from '@/components/SegmentedControl';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
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

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  accepted: 'Active',
  declined: 'Declined',
  revoked: 'Revoked',
};

const STATUS_COLOR_KEY: Record<string, 'success' | 'warning' | 'textMuted' | 'danger'> = {
  pending: 'warning',
  accepted: 'success',
  declined: 'textMuted',
  revoked: 'danger',
};

const ROLE_OPTIONS: Array<{ value: TripCollaboratorRole; label: string }> = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' },
];

/**
 * Map CollaboratorError codes to user-facing copy for the role-update failure case.
 */
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
        return "Couldn't update role. Try again.";
    }
  }
  return "Couldn't update role. Try again.";
}

export default function CollaboratorsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const bp = useBreakpoint();
  const isDesktop = bp === 'desktop';

  const { data: session } = useSession();
  const { data: trip, isLoading: tripLoading } = useTrip(id);
  const {
    data: collaborators = [],
    isLoading: collabLoading,
    error: collabError,
  } = useTripCollaborators(id);
  const inviteCollaborator = useInviteCollaborator();
  const revokeCollaborator = useRevokeCollaborator();
  const updateCollaborator = useUpdateCollaborator();

  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  // Per-row role update error messages, keyed by collaborator id.
  const [roleErrors, setRoleErrors] = useState<Record<string, string>>({});

  const isOwner = Boolean(trip && session?.user && trip.user_id === session.user.id);

  const isLoading = tripLoading || collabLoading;

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator size="large" color={t.colors.primary} />
      </Screen>
    );
  }

  if (!trip) {
    return (
      <Screen>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>Trip not found.</Text>
      </Screen>
    );
  }

  // Split collaborators: active (accepted/pending) vs. history (declined/revoked)
  const active = collaborators.filter(
    (c) => c.status === 'accepted' || c.status === 'pending',
  );
  const history = collaborators.filter(
    (c) => c.status === 'declined' || c.status === 'revoked',
  );

  function handleRoleChange(collab: TripCollaborator, newRole: TripCollaboratorRole) {
    if (newRole === collab.role) return;
    // Clear any prior error for this row before the new mutation.
    setRoleErrors((prev) => ({ ...prev, [collab.id]: '' }));
    updateCollaborator.mutate(
      { collaboratorId: collab.id, tripId: id ?? '', role: newRole },
      {
        onError: (err) => {
          setRoleErrors((prev) => ({
            ...prev,
            [collab.id]: roleUpdateErrorMessage(err),
          }));
        },
      },
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={[
          { padding: t.spacing.lg, gap: t.spacing.lg },
          isDesktop && { maxWidth: COLLAB_MAX_WIDTH, alignSelf: 'center', width: '100%' },
        ]}
      >
        <BackButton onPress={() => router.back()} label="Trip" />

        {/* Header */}
        <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
          <View style={{ flex: 1, gap: t.spacing.xs }}>
            <Text
              style={[t.typography.title, { color: t.colors.text }]}
              accessibilityRole="header"
              aria-level={1}
            >
              Collaborators
            </Text>
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              {trip.title}
            </Text>
          </View>
          {isOwner ? (
            <Button
              label="Invite"
              onPress={() => setInviteSheetOpen(true)}
              fullWidth={false}
              accessibilityLabel="Invite a collaborator by email"
            />
          ) : null}
        </View>

        {collabError ? (
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
          >
            <Text style={[t.typography.body, { color: t.colors.danger }]}>
              Could not load collaborators. Please try again.
            </Text>
          </View>
        ) : null}

        {/* Active / pending collaborators */}
        <SectionBlock label="Active collaborators">
          {active.length === 0 ? (
            <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
              No active collaborators yet.
            </Text>
          ) : (
            active.map((collab) => (
              <CollaboratorRow
                key={collab.id}
                collab={collab}
                isOwner={isOwner}
                tripId={id ?? ''}
                onRevoke={() => {
                  revokeCollaborator.mutate({ collaboratorId: collab.id, tripId: id ?? '' });
                }}
                revoking={revokeCollaborator.isPending}
                onRoleChange={(role) => handleRoleChange(collab, role)}
                updatingRole={updateCollaborator.isPending}
                roleError={roleErrors[collab.id] ?? null}
              />
            ))
          )}
        </SectionBlock>

        {/* History — only shown if there's something to show */}
        {history.length > 0 ? (
          <SectionBlock label="Past invites">
            {history.map((collab) => (
              <CollaboratorRow
                key={collab.id}
                collab={collab}
                isOwner={false}
                tripId={id ?? ''}
                onRevoke={() => {}}
                revoking={false}
                onRoleChange={() => {}}
                updatingRole={false}
                roleError={null}
              />
            ))}
          </SectionBlock>
        ) : null}
      </ScrollView>

      <InviteSheet
        tripId={id ?? ''}
        visible={inviteSheetOpen}
        onClose={() => setInviteSheetOpen(false)}
        inviteMutation={inviteCollaborator}
      />
    </Screen>
  );
}

function SectionBlock({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text
        style={[t.typography.subtitle, { color: t.colors.text }]}
        accessibilityRole="header"
        aria-level={3}
      >
        {label}
      </Text>
      {children}
    </View>
  );
}

function CollaboratorRow({
  collab,
  isOwner,
  tripId: _tripId,
  onRevoke,
  revoking,
  onRoleChange,
  updatingRole,
  roleError,
}: {
  collab: TripCollaborator;
  isOwner: boolean;
  tripId: string;
  onRevoke: () => void;
  revoking: boolean;
  onRoleChange: (role: TripCollaboratorRole) => void;
  updatingRole: boolean;
  roleError: string | null;
}) {
  const t = useTheme();
  const colorKey = STATUS_COLOR_KEY[collab.status] ?? 'textMuted';
  const statusColor = t.colors[colorKey];
  const canRevoke = isOwner && (collab.status === 'pending' || collab.status === 'accepted');
  // Role toggle only for accepted collaborators when the viewer is the owner.
  const canChangeRole = isOwner && collab.status === 'accepted';

  // Local dropdown-open state per row.
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);

  return (
    <View
      style={[
        styles.row,
        {
          flexDirection: 'column',
          backgroundColor: t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.md,
          padding: t.spacing.md,
          gap: t.spacing.sm,
          ...t.shadows.sm(t.colors.shadowColor),
        },
      ]}
      accessible={!canChangeRole}
      accessibilityLabel={
        canChangeRole
          ? undefined
          : `${collab.invitee_email}, ${collab.role}, ${STATUS_LABEL[collab.status] ?? collab.status}`
      }
    >
      {/* Main row: avatar + details + revoke */}
      <View style={[styles.row, { gap: t.spacing.sm }]}>
        {/* Avatar placeholder */}
        <View
          style={[
            styles.avatar,
            { backgroundColor: t.colors.gradientSubtle, borderRadius: t.radius.pill },
          ]}
        >
          <Text style={[t.typography.bodyStrong, { color: t.colors.primary }]}>
            {collab.invitee_email.charAt(0).toUpperCase()}
          </Text>
        </View>

        {/* Details */}
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            style={[t.typography.caption, { color: t.colors.text, fontWeight: '600' }]}
            numberOfLines={1}
          >
            {collab.invitee_email}
          </Text>
          <View style={[styles.row, { gap: t.spacing.xs }]}>
            {/* Role chip — tappable for owner + accepted rows */}
            {canChangeRole ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Role: ${collab.role}. Tap to change.`}
                accessibilityState={{ disabled: updatingRole }}
                onPress={() => setRoleDropdownOpen((v) => !v)}
                disabled={updatingRole}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: pressed
                      ? t.colors.gradientSubtle
                      : t.colors.bgMuted,
                    borderRadius: t.radius.pill,
                    paddingHorizontal: t.spacing.sm,
                    paddingVertical: 2,
                    opacity: updatingRole ? 0.5 : 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                  },
                ]}
              >
                <Text style={[t.typography.small, { color: t.colors.primary, fontWeight: '600' }]}>
                  {collab.role}
                </Text>
                {/* Chevron indicator */}
                <Text
                  style={[t.typography.small, { color: t.colors.primary, fontSize: 9 }]}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                >
                  {roleDropdownOpen ? '▲' : '▼'}
                </Text>
              </Pressable>
            ) : (
              /* Read-only role chip */
              <View
                style={[
                  styles.chip,
                  {
                    backgroundColor: t.colors.bgMuted,
                    borderRadius: t.radius.pill,
                    paddingHorizontal: t.spacing.sm,
                    paddingVertical: 2,
                  },
                ]}
              >
                <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                  {collab.role}
                </Text>
              </View>
            )}

            {/* Status chip */}
            <View
              style={[
                styles.chip,
                {
                  backgroundColor: `${statusColor}22`,
                  borderRadius: t.radius.pill,
                  paddingHorizontal: t.spacing.sm,
                  paddingVertical: 2,
                },
              ]}
            >
              <Text style={[t.typography.small, { color: statusColor, fontWeight: '600' }]}>
                {STATUS_LABEL[collab.status] ?? collab.status}
              </Text>
            </View>
          </View>
        </View>

        {/* Revoke */}
        {canRevoke ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Revoke ${collab.invitee_email}'s invitation`}
            onPress={onRevoke}
            disabled={revoking}
            style={({ pressed }) => [
              styles.revokeBtn,
              {
                backgroundColor: pressed ? t.colors.dangerLight : 'transparent',
                borderRadius: t.radius.sm,
                paddingHorizontal: t.spacing.sm,
                paddingVertical: t.spacing.xs,
                opacity: revoking ? 0.5 : 1,
              },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.danger }]}>Revoke</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Inline role dropdown — only visible when owner taps the role chip */}
      {roleDropdownOpen && canChangeRole ? (
        <View
          style={{
            backgroundColor: t.colors.bg,
            borderColor: t.colors.border,
            borderWidth: 1,
            borderRadius: t.radius.md,
            overflow: 'hidden',
          }}
          accessibilityRole="radiogroup"
          accessibilityLabel="Select role"
        >
          {ROLE_OPTIONS.map((opt) => {
            const isSelected = collab.role === opt.value;
            return (
              <Pressable
                key={opt.value}
                accessibilityRole="radio"
                accessibilityLabel={opt.value === 'viewer'
                  ? 'Viewer — can see itinerary but cannot edit'
                  : 'Editor — can add and edit places and expenses'}
                accessibilityState={{ checked: isSelected }}
                onPress={() => {
                  setRoleDropdownOpen(false);
                  onRoleChange(opt.value);
                }}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row' as const,
                    alignItems: 'center' as const,
                    justifyContent: 'space-between' as const,
                    padding: t.spacing.md,
                    backgroundColor: isSelected
                      ? t.colors.gradientSubtle
                      : pressed
                        ? t.colors.bgMuted
                        : 'transparent',
                  },
                ]}
              >
                <View style={{ gap: 2 }}>
                  <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: isSelected ? '600' : '400' }]}>
                    {opt.label}
                  </Text>
                  <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
                    {opt.value === 'viewer'
                      ? 'Can see itinerary, map, and expenses'
                      : 'Can add and edit places and expenses'}
                  </Text>
                </View>
                {isSelected ? (
                  <Text
                    style={[t.typography.caption, { color: t.colors.primary }]}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  >
                    ✓
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Per-row role update error */}
      {roleError ? (
        <Text
          style={[t.typography.caption, { color: t.colors.danger }]}
          accessibilityLiveRegion="polite"
        >
          {roleError}
        </Text>
      ) : null}
    </View>
  );
}

function InviteSheet({
  tripId,
  visible,
  onClose,
  inviteMutation,
}: {
  tripId: string;
  visible: boolean;
  onClose: () => void;
  inviteMutation: ReturnType<typeof useInviteCollaborator>;
}) {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TripCollaboratorRole>('viewer');
  const [error, setError] = useState<string | null>(null);
  const [successUrl, setSuccessUrl] = useState<string | null>(null);

  function handleClose() {
    setEmail('');
    setRole('viewer');
    setError(null);
    setSuccessUrl(null);
    onClose();
  }

  async function handleInvite() {
    if (!email.trim()) {
      setError('Email address is required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    try {
      const result = await inviteMutation.mutateAsync({
        tripId,
        inviteeEmail: email.trim().toLowerCase(),
        role,
      });
      setSuccessUrl(result.inviteUrl);
    } catch (err) {
      if (err instanceof CollaboratorError && err.code === 'already_invited') {
        setError('This person already has a pending invite for this trip.');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Could not send invite. Please try again.');
      }
    }
  }

  return (
    <BottomSheet visible={visible} onClose={handleClose} accessibilityLabel="Invite collaborator">
      <Text
        style={[t.typography.subtitle, { color: t.colors.text }]}
        accessibilityRole="header"
        aria-level={3}
      >
        Invite collaborator
      </Text>

      {successUrl ? (
        <View style={{ gap: t.spacing.md }}>
          <Text style={[t.typography.body, { color: t.colors.success }]}>
            Invite sent! If the email didn't arrive, share this link directly:
          </Text>
          <Text
            style={[t.typography.caption, { color: t.colors.textMuted }]}
            selectable
            numberOfLines={3}
          >
            {successUrl}
          </Text>
          <Button label="Done" onPress={handleClose} />
        </View>
      ) : (
        <View style={{ gap: t.spacing.md }}>
          <View style={{ gap: t.spacing.xs }}>
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
              Email address
            </Text>
            <TextInput
              value={email}
              onChangeText={(v) => { setEmail(v); setError(null); }}
              placeholder="collaborator@email.com"
              placeholderTextColor={t.colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Collaborator email address"
              style={[
                styles.emailInput,
                {
                  borderColor: error ? t.colors.danger : t.colors.border,
                  borderRadius: t.radius.md,
                  backgroundColor: t.colors.bgElevated,
                  color: t.colors.text,
                  ...t.typography.body,
                  padding: t.spacing.md,
                },
              ]}
            />
            {error ? (
              <Text
                style={[t.typography.caption, { color: t.colors.danger }]}
                accessibilityLiveRegion="polite"
              >
                {error}
              </Text>
            ) : null}
          </View>

          <SegmentedControl<TripCollaboratorRole>
            label="Role"
            value={role}
            onChange={setRole}
            options={ROLE_OPTIONS}
          />

          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            {role === 'viewer'
              ? 'Viewers can see the itinerary, map, and expenses — but cannot make changes.'
              : 'Editors can add and edit places, notes, and expenses.'}
          </Text>

          <Button
            label="Send invite"
            onPress={handleInvite}
            loading={inviteMutation.isPending}
          />
          <Button label="Cancel" variant="ghost" onPress={handleClose} />
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  chip: {},
  avatar: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revokeBtn: {},
  emailInput: { borderWidth: 1 },
  errorBox: { borderWidth: 1 },
});
