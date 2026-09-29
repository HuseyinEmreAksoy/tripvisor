/**
 * ShareToggles — what a public link shows (M5 Y3.5): itinerary, the expense
 * summary and the owner's memories. Pure controlled UI: the caller decides
 * whether a flip goes to the live link (`useUpdateShareSettings`) or to the
 * draft used when the link is created.
 *
 * Each row is one switch with a visible label + hint; the switch carries the
 * label as its accessible name and the hint as its description.
 */
import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { useT } from '@/i18n';
import type { ShareSettings } from '@/api/share';
import { Icon, type IconName } from '../Icon';

export type ShareToggleKey = keyof ShareSettings;

const ROWS = [
  { key: 'showItinerary', icon: 'route', label: 'toggles.itinerary.label', hint: 'toggles.itinerary.hint' },
  { key: 'showExpenses', icon: 'wallet', label: 'toggles.expenses.label', hint: 'toggles.expenses.hint' },
  { key: 'showMemories', icon: 'camera', label: 'toggles.memories.label', hint: 'toggles.memories.hint' },
] as const satisfies ReadonlyArray<{ key: ShareToggleKey; icon: IconName; label: string; hint: string }>;

interface Props {
  settings: ShareSettings;
  onChange: (key: ShareToggleKey, value: boolean) => void;
  /** True when a link is live (changes apply immediately), false for the create draft. */
  live: boolean;
  disabled?: boolean;
}

export function ShareToggles({ settings, onChange, live, disabled = false }: Props) {
  const t = useTheme();
  const { t: tx } = useT('share');

  return (
    <View style={{ gap: t.spacing.sm }}>
      <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '700' }]} accessibilityRole="header">
        {tx('toggles.heading')}
      </Text>
      <View
        style={[
          styles.group,
          { borderColor: t.colors.border, borderRadius: t.radius.lg, backgroundColor: t.colors.bgElevated },
        ]}
      >
        {ROWS.map((row, i) => {
          const value = settings[row.key];
          const label = tx(row.label);
          const hint = tx(row.hint);
          return (
            <Pressable
              key={row.key}
              onPress={() => onChange(row.key, !value)}
              disabled={disabled}
              accessibilityRole="switch"
              accessibilityLabel={label}
              accessibilityHint={hint}
              accessibilityState={{ checked: value, disabled }}
              style={({ pressed }) => [
                styles.row,
                {
                  gap: t.spacing.md,
                  padding: t.spacing.md,
                  borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
                  borderTopColor: t.colors.border,
                  backgroundColor: pressed ? t.colors.bgMuted : 'transparent',
                  opacity: disabled ? 0.6 : 1,
                },
              ]}
            >
              <View style={[styles.icon, { backgroundColor: t.colors.gradientSubtle, borderRadius: t.radius.pill }]}>
                <Icon name={row.icon} size={16} color={t.colors.primaryInk} />
              </View>
              <View style={styles.text}>
                <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{label}</Text>
                <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{hint}</Text>
              </View>
              {/* The row is the control; the Switch is its visual state only. */}
              <View pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <Switch
                  value={value}
                  disabled={disabled}
                  trackColor={{ false: t.colors.borderStrong, true: t.colors.primary }}
                  thumbColor={Platform.OS === 'android' ? t.colors.cardBgSolid : undefined}
                  {...(Platform.OS === 'web' ? { tabIndex: -1, 'aria-hidden': true } : {})}
                />
              </View>
            </Pressable>
          );
        })}
      </View>
      <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
        {live ? tx('toggles.liveNote') : tx('toggles.draftNote')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { borderWidth: 1, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  icon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 2 },
});
