/**
 * WeatherChip — compact per-day forecast chip for itinerary day headers
 * (v2 Phase P2.1).
 *
 * Face: weather emoji by WMO code group + daily high ("☔ 18°"). Purely
 * presentational — the parent (ItineraryTab) owns the single useDayWeather
 * query and the date→day mapping (see tripWeather.ts).
 *
 * Rainy-day behavior: when the parent passes `onPressRainy` (editors only,
 * and only for days where `isRainy(day)` is true) the chip becomes a button
 * that opens GapFillSheet — the Ideas-first "swap something indoor in" fix.
 * For everyone else it renders as plain, non-interactive text.
 *
 * Accessibility: the emoji alone is unpronounceable, so the chip carries a
 * full spoken label ("Day 3 forecast: rain, high 18 degrees…"). Tappable
 * chips get accessibilityRole="button" + an action hint; static chips are
 * plain labeled text.
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type { DayWeather } from '@/api';
import { useTheme } from '@/theme';
import { weatherEmoji, weatherLabel } from './tripWeather';

export interface WeatherChipProps {
  day: DayWeather;
  /** 1-based day number, for the spoken label. */
  dayNumber: number;
  /** Present only when the day is rainy AND the viewer can edit — makes the chip tappable. */
  onPressRainy?: (() => void) | null;
}

export function WeatherChip({ day, dayNumber, onPressRainy }: WeatherChipProps) {
  const t = useTheme();
  const high = Math.round(day.tMaxC);
  const face = `${weatherEmoji(day.weatherCode)} ${high}°`;
  const spoken = `Day ${dayNumber} forecast: ${weatherLabel(day.weatherCode)}, high ${high} degrees`;

  const chipFrame = [
    styles.chip,
    {
      borderColor: t.colors.border,
      backgroundColor: t.colors.bgElevated,
      borderRadius: t.radius.pill,
    },
  ];

  if (onPressRainy) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${spoken}. Looks wet — see indoor ideas for this day`}
        onPress={onPressRainy}
        hitSlop={4}
        style={({ pressed }) => [
          ...chipFrame,
          { opacity: pressed ? 0.6 : 1 },
          Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
        ]}
      >
        <Text style={[t.typography.small, { color: t.colors.text, fontWeight: '600' }]}>
          {face}
        </Text>
      </Pressable>
    );
  }

  return (
    <View accessible accessibilityLabel={spoken} style={chipFrame}>
      <Text style={[t.typography.small, { color: t.colors.text, fontWeight: '600' }]}>{face}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    minHeight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
