/**
 * CollaboratorRow — one person on the collaborators screen, phone-first.
 *
 *   [avatar]  email@example.com                [Remove]
 *             (Viewer)(Editor)   ← owner + accepted: inline role chips
 *             Viewer · Pending   ← everyone else: read-only chips
 *             Sent 2 days ago · expires in 5 days   (pending only)
 *
 * Role chips are a radiogroup (two chips, one tap to switch) instead of a
 * dropdown so they stay thumb-friendly at 375px. Revoke/cancel is confirmed
 * by the parent before the mutation runs.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import type { TripCollaborator, TripCollaboratorRole } from '@/api/types';
import { ROLE_COPY, STATUS_LABEL, inviteAge } from './collaboratorModel';

const ROLES: TripCollaboratorRole[] = ['viewer', 'editor'];

export interface CollaboratorRowProps {
  collab: TripCollaborator;
  /** Viewer of the screen owns the trip → may revoke / change roles. */
  canManage: boolean;
  onRevoke?: () => void;
  revoking?: boolean;
  onRoleChange?: (role: TripCollaboratorRole) => void;
  updatingRole?: boolean;
  roleError?: string | null;
  /** Injectable clock for tests. */
  now?: Date;
}

export function CollaboratorRow({
  collab,
  canManage,
  onRevoke,
  revoking = false,
  onRoleChange,
  updatingRole = false,
  roleError,
  now,
}: CollaboratorRowProps) {
  const t = useTheme();
  const isPending = collab.status === 'pending';
  const canRevoke = canManage && (isPending || collab.status === 'accepted') && Boolean(onRevoke);
  const canChangeRole = canManage && collab.status === 'accepted' && Boolean(onRoleChange);
  const age = isPending ? inviteAge(collab.created_at, now) : null;
  const statusLabel = age?.expired ? 'Expired' : STATUS_LABEL[collab.status];
  const statusColor =
    collab.status === 'accepted'
      ? t.colors.success
      : isPending && !age?.expired
        ? t.colors.warningText
        : t.colors.textMuted;
  const statusBg =
    collab.status === 'accepted'
      ? t.colors.successLight
      : isPending && !age?.expired
        ? t.colors.warningLight
        : t.colors.bgMuted;
  const revokeLabel = isPending ? 'Cancel' : 'Remove';

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.colors.cardBgSolid,
          borderColor: t.colors.border,
          borderRadius: t.radius.lg,
          padding: t.spacing.md,
          gap: t.spacing.sm,
          ...t.shadows.sm(t.colors.shadowColor),
        },
      ]}
    >
      <View style={[styles.row, { gap: t.spacing.md }]}>
        <View
          style={[styles.avatar, { backgroundColor: t.colors.gradientSubtle, borderRadius: t.radius.pill }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text style={[t.typography.bodyStrong, { color: t.colors.primaryInk }]}>
            {collab.invitee_email.charAt(0).toUpperCase()}
          </Text>
        </View>

        <View
          style={styles.flex}
          accessible
          accessibilityLabel={`${collab.invitee_email}, ${ROLE_COPY[collab.role].label}, ${statusLabel}${
            age ? `, ${age.label}` : ''
          }`}
        >
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} numberOfLines={1}>
            {collab.invitee_email}
          </Text>
          {!canChangeRole ? (
            <View style={[styles.row, styles.wrap, { gap: t.spacing.xs, marginTop: t.spacing.xs }]}>
              <Chip label={ROLE_COPY[collab.role].label} color={t.colors.textMuted} bg={t.colors.bgMuted} />
              <Chip label={statusLabel} color={statusColor} bg={statusBg} />
            </View>
          ) : null}
          {age ? (
            <Text
              style={[
                t.typography.small,
                { color: age.expired ? t.colors.danger : t.colors.textMuted, marginTop: t.spacing.xs },
              ]}
            >
              {age.label}
            </Text>
          ) : null}
        </View>

        {canRevoke ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              isPending
                ? `Cancel the invite for ${collab.invitee_email}`
                : `Remove ${collab.invitee_email} from this trip`
            }
            accessibilityState={{ disabled: revoking, busy: revoking }}
            onPress={onRevoke}
            disabled={revoking}
            hitSlop={8}
            style={({ pressed }) => [
              styles.revokeBtn,
              {
                borderColor: t.colors.border,
                borderRadius: t.radius.pill,
                paddingHorizontal: t.spacing.md,
                backgroundColor: pressed ? t.colors.dangerLight : 'transparent',
                opacity: revoking ? 0.5 : 1,
              },
            ]}
          >
            <Text style={[t.typography.caption, { color: t.colors.danger, fontWeight: '600' }]}>
              {revoking ? '…' : revokeLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {canChangeRole ? (
        <View
          style={[styles.row, styles.wrap, { gap: t.spacing.sm }]}
          accessibilityRole="radiogroup"
          accessibilityLabel={`Role for ${collab.invitee_email}`}
        >
          {ROLES.map((role) => {
            const selected = collab.role === role;
            return (
              <Pressable
                key={role}
                accessibilityRole="radio"
                accessibilityLabel={`${ROLE_COPY[role].label} — ${ROLE_COPY[role].hint}`}
                accessibilityState={{ checked: selected, disabled: updatingRole }}
                disabled={updatingRole}
                onPress={() => {
                  if (!selected) onRoleChange?.(role);
                }}
                style={({ pressed }) => [
                  styles.roleChip,
                  {
                    borderRadius: t.radius.pill,
                    borderColor: selected ? t.colors.primary : t.colors.border,
                    backgroundColor: selected
                      ? t.colors.gradientSubtle
                      : pressed
                        ? t.colors.bgMuted
                        : 'transparent',
                    paddingHorizontal: t.spacing.md,
                    opacity: updatingRole ? 0.6 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    t.typography.caption,
                    { color: selected ? t.colors.primaryInk : t.colors.text, fontWeight: selected ? '700' : '500' },
                  ]}
                >
                  {selected ? '✓ ' : ''}
                  {ROLE_COPY[role].label}
                </Text>
              </Pressable>
            );
          })}
          <Chip label={statusLabel} color={statusColor} bg={statusBg} />
        </View>
      ) : null}

      {roleError ? (
        <Text style={[t.typography.caption, { color: t.colors.danger }]} accessibilityLiveRegion="polite">
          {roleError}
        </Text>
      ) : null}
    </View>
  );
}

function Chip({ label, color, bg }: { label: string; color: string; bg: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        backgroundColor: bg,
        borderRadius: t.radius.pill,
        paddingHorizontal: t.spacing.sm,
        paddingVertical: 2,
      }}
    >
      <Text style={[t.typography.small, { color, fontWeight: '600' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  wrap: { flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 0 },
  avatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  revokeBtn: { borderWidth: 1, minHeight: 36, justifyContent: 'center' },
  roleChip: { borderWidth: 1, minHeight: 36, justifyContent: 'center' },
});
