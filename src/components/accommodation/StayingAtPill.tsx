/**
 * StayingAtPill — a small pill rendered next to each Day N header in the
 * itinerary showing the accommodation that covers that night.
 *
 * If multiple accommodations cover the same day, shows the first and allows
 * tapping to see all (via a small inline expansion on native; a tooltip-style
 * expansion on web through the same Pressable toggle pattern).
 *
 * "Covers a night" means: check_in_date ≤ tripDate < check_out_date
 * (i.e. the accommodation is active during that day's night).
 * tripDate is computed as tripStartDate + dayIndex days.
 */
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { Icon } from '@/components/Icon';
import type { TripAccommodation } from '@/api/types';

export interface StayingAtPillProps {
  dayIndex: number;
  tripStartDate: string | null;
  accommodations: TripAccommodation[];
}

export function StayingAtPill({ dayIndex, tripStartDate, accommodations }: StayingAtPillProps) {
  const t = useTheme();
  const [expanded, setExpanded] = useState(false);

  const covering = useMemo(() => {
    if (!tripStartDate || accommodations.length === 0) return [];
    try {
      const startMs = new Date(tripStartDate).getTime();
      const dayMs = startMs + dayIndex * 86400000;
      const dayDate = new Date(dayMs).toISOString().slice(0, 10);
      return accommodations.filter(
        (acc) => acc.check_in_date <= dayDate && dayDate < acc.check_out_date,
      );
    } catch {
      return [];
    }
  }, [dayIndex, tripStartDate, accommodations]);

  if (covering.length === 0) return null;

  const first = covering[0]!;
  const hasMore = covering.length > 1;

  return (
    <Pressable
      onPress={hasMore ? () => setExpanded((v) => !v) : undefined}
      accessibilityRole={hasMore ? 'button' : 'text'}
      accessibilityLabel={
        expanded || !hasMore
          ? `Staying at: ${covering.map((a) => a.name).join(', ')}`
          : `Staying at: ${first.name}. Tap to see ${covering.length - 1} more.`
      }
      style={[
        styles.pill,
        {
          backgroundColor: t.colors.gradientSubtle,
          borderColor: t.colors.primary,
          borderRadius: t.radius.pill,
          paddingHorizontal: t.spacing.sm,
          paddingVertical: 3,
          alignSelf: 'flex-start',
        },
      ]}
    >
      <Icon name="bed" size={13} color={t.colors.primaryInk} />
      <Text
        style={[t.typography.small, styles.label, { color: t.colors.primaryInk, fontWeight: '600' }]}
      >
        {expanded
          ? covering.map((a) => a.name).join(', ')
          : hasMore
            ? `${first.name} +${covering.length - 1}`
            : first.name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { flexShrink: 1 },
});
