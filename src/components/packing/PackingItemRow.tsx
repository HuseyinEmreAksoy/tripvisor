/**
 * PackingItemRow — one checklist row on the packing screen (v2 Phase P2.2).
 *
 * The whole row body is the checkbox (label tap toggles too — a 44pt+ target
 * beats a 22pt box). Checked items render struck-through + muted; seeded
 * items carry a subtle "(suggested)" tag. Delete is a separate ✕ button so
 * a toggle mis-tap can never destroy data — the parent wraps it in the
 * confirm dialog.
 *
 * Viewers (canEdit=false) see the row read-only: the checkbox reports
 * `disabled` to assistive tech and the ✕ is not rendered at all.
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type { TripPackingItem } from '@/api';
import { useTheme } from '@/theme';

export interface PackingItemRowProps {
  item: TripPackingItem;
  canEdit: boolean;
  /** Toggle handler — parent runs the optimistic mutation. */
  onToggle: (checked: boolean) => void;
  /** Delete handler — parent owns the destructive confirm. */
  onDelete: () => void;
}

export function PackingItemRow({ item, canEdit, onToggle, onDelete }: PackingItemRowProps) {
  const t = useTheme();

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.md,
          paddingHorizontal: t.spacing.md,
          gap: t.spacing.sm,
        },
      ]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`${item.label}${item.auto ? ', suggested item' : ''}`}
        accessibilityState={{ checked: item.checked, disabled: !canEdit }}
        disabled={!canEdit}
        onPress={() => onToggle(!item.checked)}
        hitSlop={4}
        style={({ pressed }) => [
          styles.toggleArea,
          { gap: t.spacing.sm, opacity: pressed ? 0.6 : 1 },
          Platform.OS === 'web' &&
            ({ cursor: canEdit ? 'pointer' : 'default' } as ViewStyle),
        ]}
      >
        {/* Checkbox visual — state is conveyed via accessibilityState above,
            so the glyph itself is decorative. */}
        <View
          style={[
            styles.box,
            {
              borderColor: item.checked ? t.colors.primary : t.colors.borderStrong,
              backgroundColor: item.checked ? t.colors.primary : 'transparent',
              borderRadius: t.radius.sm,
            },
          ]}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {item.checked ? (
            <Text style={[styles.tick, { color: t.colors.primaryText }]}>✓</Text>
          ) : null}
        </View>
        <Text
          style={[
            t.typography.body,
            {
              color: item.checked ? t.colors.textMuted : t.colors.text,
              textDecorationLine: item.checked ? 'line-through' : 'none',
              flexShrink: 1,
            },
          ]}
        >
          {item.label}
          {item.auto ? (
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
              {'  (suggested)'}
            </Text>
          ) : null}
        </Text>
      </Pressable>

      {canEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.label} from the packing list`}
          onPress={onDelete}
          hitSlop={8}
          style={({ pressed }) => [
            styles.deleteBtn,
            {
              borderRadius: t.radius.sm,
              backgroundColor: pressed ? t.colors.dangerLight : 'transparent',
            },
            Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
          ]}
        >
          <Text style={[t.typography.body, { color: t.colors.textMuted }]}>✕</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    minHeight: 48,
  },
  toggleArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  box: {
    width: 22,
    height: 22,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: { fontSize: 14, fontWeight: '700', lineHeight: 18 },
  deleteBtn: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
