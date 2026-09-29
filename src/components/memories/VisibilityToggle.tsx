/**
 * VisibilityToggle — the per-item "Share with trip" switch (M5 Y3.1).
 *
 * Memories are PRIVATE by default ('only_me'); ON = visibility 'trip'
 * (every accepted trip member can see it). The helper line always says who
 * can see the item, so the state is never colour-only.
 *
 * VisibilityBadge — the compact read-only marker (lock / people) used on
 * photo tiles and cards.
 */
import { Switch, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';
import type { MemoryVisibility } from '@/api/memories.types';

export interface VisibilityToggleProps {
  visibility: MemoryVisibility;
  onChange: (next: MemoryVisibility) => void;
  /** What is being shared, for the screen-reader label ("journal entry"). */
  itemLabel: string;
  disabled?: boolean;
  /** Hide the "who can see this" helper line (tight rows). */
  compact?: boolean;
}

export function VisibilityToggle({ visibility, onChange, itemLabel, disabled = false, compact = false }: VisibilityToggleProps) {
  const t = useTheme();
  const { t: tx } = useT('memories');
  const shared = visibility === 'trip';
  return (
    <View style={[styles.row, { gap: t.spacing.sm }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[t.typography.caption, { color: t.colors.text }]}>{tx('visibility.label')}</Text>
        {compact ? null : (
          <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
            {shared ? tx('visibility.trip') : tx('visibility.onlyMe')}
          </Text>
        )}
      </View>
      <Switch
        value={shared}
        disabled={disabled}
        onValueChange={(on) => onChange(on ? 'trip' : 'only_me')}
        accessibilityLabel={tx('visibility.a11y', { item: itemLabel })}
        accessibilityHint={shared ? tx('visibility.trip') : tx('visibility.onlyMe')}
        trackColor={{ true: t.colors.primary, false: t.colors.textMuted }}
        thumbColor={t.colors.bgElevated}
      />
    </View>
  );
}

export function VisibilityBadge({ visibility, onDark = false }: { visibility: MemoryVisibility; onDark?: boolean }) {
  const t = useTheme();
  const { t: tx } = useT('memories');
  const shared = visibility === 'trip';
  const label = shared ? tx('visibility.badgeShared') : tx('visibility.badgePrivate');
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[
        styles.badge,
        {
          backgroundColor: onDark ? t.colors.heroGlass : t.colors.bgMuted,
          borderRadius: t.radius.pill,
          paddingHorizontal: t.spacing.sm,
          gap: 4,
        },
      ]}
    >
      <Icon name={shared ? 'users' : 'lock'} size={12} color={onDark ? t.colors.heroChipText : t.colors.textMuted} />
      <Text style={[t.typography.small, { color: onDark ? t.colors.heroChipText : t.colors.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingVertical: 2 },
});
