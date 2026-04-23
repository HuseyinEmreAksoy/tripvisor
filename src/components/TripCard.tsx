import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import type { Trip } from '@/api';

interface Props {
  trip: Trip;
  onPress: () => void;
}

export function TripCard({ trip, onPress }: Props) {
  const t = useTheme();
  const dateRange = formatDateRange(trip.start_date, trip.end_date);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open trip ${trip.title}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.lg,
          padding: t.spacing.lg,
          gap: t.spacing.xs,
        },
        pressed && styles.pressed,
      ]}
    >
      <Text style={[t.typography.subtitle, { color: t.colors.text }]} numberOfLines={1}>
        {trip.title}
      </Text>
      {dateRange ? (
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>{dateRange}</Text>
      ) : null}
      <View style={styles.meta}>
        <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
          {trip.daily_hours_budget}h / day · {trip.transport_mode}
        </Text>
      </View>
    </Pressable>
  );
}

function formatDateRange(start: string | null, end: string | null): string | null {
  if (!start && !end) return null;
  if (start && end) return `${start} → ${end}`;
  return start ?? end;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  meta: { marginTop: 4 },
  pressed: { opacity: 0.85 },
});
