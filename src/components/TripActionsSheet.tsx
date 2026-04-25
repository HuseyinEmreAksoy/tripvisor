/**
 * TripActionsSheet
 *
 * A BottomSheet that renders Archive / Unarchive, Duplicate, and Delete
 * actions for a trip. Opened by the overflow trigger on TripCard.
 *
 * Handlers are passed in as props so the parent (trips.tsx) can supply
 * real mutation calls (Step 7.8). For Step 7.5 they are optional no-ops.
 *
 * Usage:
 *   <TripActionsSheet
 *     visible={sheetOpen}
 *     onClose={() => setSheetOpen(false)}
 *     trip={trip}
 *     onArchive={(id) => archiveMutation.mutate(id)}
 *     onUnarchive={(id) => unarchiveMutation.mutate(id)}
 *     onDuplicate={(id) => duplicateMutation.mutate(id)}
 *     onDelete={(id) => deleteMutation.mutate(id)}
 *   />
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { useTheme } from '@/theme';
import type { Trip } from '@/api';

export interface TripActionsSheetProps {
  visible: boolean;
  onClose: () => void;
  trip: Trip;
  onArchive?: (id: string) => void;
  onUnarchive?: (id: string) => void;
  onDuplicate?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export function TripActionsSheet({
  visible,
  onClose,
  trip,
  onArchive,
  onUnarchive,
  onDuplicate,
  onDelete,
}: TripActionsSheetProps) {
  const t = useTheme();
  const isArchived = trip.archived_at != null;

  const handleAction = (handler?: (id: string) => void) => {
    onClose();
    handler?.(trip.id);
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel="Trip actions"
    >
      {/* ─── Archive / Unarchive ─────────────────────────────────────── */}
      <ActionRow
        label={isArchived ? 'Unarchive' : 'Archive'}
        accessibilityLabel={isArchived ? 'Unarchive trip' : 'Archive trip'}
        onPress={() => handleAction(isArchived ? onUnarchive : onArchive)}
      />

      {/* ─── Duplicate ───────────────────────────────────────────────── */}
      <ActionRow
        label="Duplicate"
        accessibilityLabel="Duplicate trip"
        onPress={() => handleAction(onDuplicate)}
      />

      {/* ─── Delete (destructive) ────────────────────────────────────── */}
      <ActionRow
        label="Delete"
        accessibilityLabel="Delete trip"
        accessibilityHint="Permanently deletes the trip"
        destructive
        onPress={() => handleAction(onDelete)}
      />

      {/* ─── Cancel ──────────────────────────────────────────────────── */}
      <View style={[styles.divider, { backgroundColor: t.colors.border }]} />
      <ActionRow
        label="Cancel"
        accessibilityLabel="Cancel"
        onPress={onClose}
      />
    </BottomSheet>
  );
}

// ─── Internal row component ───────────────────────────────────────────────────

interface ActionRowProps {
  label: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  destructive?: boolean;
  onPress: () => void;
}

function ActionRow({
  label,
  accessibilityLabel,
  accessibilityHint,
  destructive = false,
  onPress,
}: ActionRowProps) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          borderRadius: t.radius.md,
          paddingVertical: t.spacing.md,
          paddingHorizontal: t.spacing.lg,
          backgroundColor: pressed ? t.colors.bgMuted : 'transparent',
        },
      ]}
    >
      <Text
        style={[
          t.typography.body,
          { color: destructive ? t.colors.danger : t.colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 44, justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
});
