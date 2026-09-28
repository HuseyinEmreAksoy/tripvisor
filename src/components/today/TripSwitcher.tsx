/**
 * TripSwitcher — chip row shown when more than one trip is running today
 * (v2 M4 X2.1). Horizontal scroll on phones; radio semantics for a11y.
 */
import { Platform, Pressable, ScrollView, StyleSheet, Text, type ViewStyle } from 'react-native';
import { haptics } from '@/lib/haptics';
import { useTheme } from '@/theme';
import { MIN_TOUCH } from './todayStyles';

export interface TripSwitcherProps {
  trips: ReadonlyArray<{ id: string; title: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
}

export function TripSwitcher({ trips, selectedId, onSelect }: TripSwitcherProps) {
  const t = useTheme();
  if (trips.length < 2) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel="Trips happening today"
      contentContainerStyle={{ gap: t.spacing.sm }}
    >
      {trips.map((trip) => {
        const selected = trip.id === selectedId;
        return (
          <Pressable
            key={trip.id}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={trip.title}
            onPress={() => {
              if (selected) return;
              haptics.tap();
              onSelect(trip.id);
            }}
            style={({ pressed }) => [
              styles.chip,
              {
                borderRadius: t.radius.pill,
                paddingHorizontal: t.spacing.lg,
                backgroundColor: selected ? t.colors.primary : t.colors.bgElevated,
                borderColor: selected ? t.colors.primary : t.colors.border,
                opacity: pressed ? 0.75 : 1,
              },
              Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
            ]}
          >
            <Text
              style={[t.typography.bodyStrong, { fontSize: 15, color: selected ? t.colors.primaryText : t.colors.text }]}
              numberOfLines={1}
            >
              {trip.title}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: MIN_TOUCH, borderWidth: 1.5, justifyContent: 'center', maxWidth: 260 },
});
