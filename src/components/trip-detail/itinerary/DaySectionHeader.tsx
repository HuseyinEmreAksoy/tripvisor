/**
 * DaySectionHeader — the itinerary day header (v2 M4 X2.3, extracted from
 * ItineraryTab): colored day dot + bold title as a collapse toggle, then
 * the day's chips (weather, staying-at, start time) passed as children.
 *
 * The toggle is its own Pressable and the chips are SIBLINGS, never
 * children, so the web DOM has no nested <button>s. A collapsed header
 * shows a one-line "N places" summary so the day still reads at a glance.
 */
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
// Direct types import: keeps the map runtime out of this module graph.
import { dayColor } from '@/components/Map/types';
import { Icon } from '@/components/Icon';

export interface DaySectionHeaderProps {
  dayIndex: number;
  /** "Day 3" / "💡 Ideas". */
  title: string;
  /** Optional date suffix ("Mon 12"). */
  dateLabel?: string | null;
  isToday?: boolean;
  collapsed: boolean;
  onToggle: () => void;
  placeCount: number;
  subtitle?: string | null;
  children?: ReactNode;
}

export function DaySectionHeader({
  dayIndex,
  title,
  dateLabel,
  isToday = false,
  collapsed,
  onToggle,
  placeCount,
  subtitle,
  children,
}: DaySectionHeaderProps) {
  const t = useTheme();
  const countLabel = `${placeCount} place${placeCount === 1 ? '' : 's'}`;
  return (
    <View style={[styles.header, { paddingTop: t.spacing.sm }]}>
      <View style={[styles.row, { gap: t.spacing.sm }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}${dateLabel ? `, ${dateLabel}` : ''}${isToday ? ', today' : ''}, ${countLabel}. ${collapsed ? 'Show' : 'Hide'} this day's places.`}
          accessibilityState={{ expanded: !collapsed }}
          onPress={onToggle}
          style={({ pressed }) => [
            styles.toggle,
            { gap: t.spacing.sm, opacity: pressed ? 0.7 : 1 },
            Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
          ]}
        >
          <View
            style={[styles.dayDot, { backgroundColor: dayColor(dayIndex) }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <Text style={[t.typography.subtitle, { color: t.colors.text }]}>{title}</Text>
          {dateLabel ? (
            <Text style={[t.typography.caption, { color: t.colors.textMuted, fontWeight: '600' }]}>
              {dateLabel}
            </Text>
          ) : null}
          {isToday ? (
            <View
              style={[
                styles.todayPill,
                { backgroundColor: t.colors.primary, borderRadius: t.radius.pill },
              ]}
            >
              <Text style={[t.typography.small, { color: t.colors.primaryText, fontWeight: '700' }]}>
                Today
              </Text>
            </View>
          ) : null}
          {collapsed ? (
            <Text style={[t.typography.small, { color: t.colors.textMuted }]}>· {countLabel}</Text>
          ) : null}
          <View style={{ transform: [{ rotate: collapsed ? '0deg' : '90deg' }] }}>
            <Icon name="chevron-right" size={16} color={t.colors.textMuted} />
          </View>
        </Pressable>
        {collapsed ? null : children}
      </View>
      {subtitle && !collapsed ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{subtitle}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  // minHeight 44: the whole title group is the collapse target.
  toggle: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  dayDot: { width: 10, height: 10, borderRadius: 5 },
  todayPill: { paddingHorizontal: 8, paddingVertical: 2 },
});
