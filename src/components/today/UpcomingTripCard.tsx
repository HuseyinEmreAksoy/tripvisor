/**
 * UpcomingTripCard — the Today tab between trips (v2 M4 X2.1): countdown to
 * the next trip plus a prep checklist (packed X/Y, documents, first night's
 * stay, first-day weather when inside the forecast horizon). Each prep row
 * taps into the screen that fixes it.
 *
 * Reads existing hooks only; weather is Open-Meteo (keyless), no Google.
 */
import { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import {
  useDayWeather,
  useTripAccommodations,
  useTripDocuments,
  useTripPackingItems,
  useTripPlaces,
  type Trip,
} from '@/api';
import { Button } from '@/components/Button';
import { Icon, type IconName } from '@/components/Icon';
import { buildTripWeatherParams, weatherEmoji, weatherLabel } from '@/components/trip-detail/tripWeather';
import { useTheme } from '@/theme';
import { staysForNight } from './todayPlan';
import { MIN_TOUCH, useTodayCardStyle } from './todayStyles';

export interface UpcomingTripCardProps {
  trip: Trip;
  daysUntil: number;
}

export function UpcomingTripCard({ trip, daysUntil }: UpcomingTripCardProps) {
  const t = useTheme();
  const router = useRouter();
  const card = useTodayCardStyle();

  const { data: packing } = useTripPackingItems(trip.id);
  const { data: documents } = useTripDocuments(trip.id);
  const { data: stays } = useTripAccommodations(trip.id);
  const { data: places } = useTripPlaces(trip.id);

  const weatherParams = useMemo(
    () =>
      buildTripWeatherParams({ tripStartDate: trip.start_date, places: places ?? [], maxDayIndex: 0 }),
    [trip.start_date, places],
  );
  const { data: weatherDays } = useDayWeather(weatherParams);
  const firstDay = weatherDays?.find((d) => d.date === trip.start_date);

  const liveItems = (packing ?? []).filter((i) => !i.deleted);
  const packed = liveItems.filter((i) => i.checked).length;
  const firstNight = trip.start_date ? staysForNight(stays ?? [], trip.start_date)[0] : undefined;
  const docCount = documents?.length ?? 0;

  const openTrip = () => router.push({ pathname: '/trip/[id]', params: { id: trip.id } });
  const openPacking = () => router.push({ pathname: '/trip/[id]/packing', params: { id: trip.id } });

  return (
    <View style={[card, { gap: t.spacing.lg }]}>
      <View style={{ gap: t.spacing.xs }}>
        <Text style={[t.typography.overline, { color: t.colors.textMuted }]}>No trip today</Text>
        <Text style={[t.typography.title, { color: t.colors.text }]} accessibilityRole="header" aria-level={2}>
          {daysUntil === 1 ? `1 day to ${trip.title}` : `${daysUntil} days to ${trip.title}`}
        </Text>
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          When your trip starts, this tab becomes your day-by-day companion.
        </Text>
      </View>

      <View style={{ gap: t.spacing.xs }}>
        <Text style={[t.typography.subtitle, { color: t.colors.text }]} accessibilityRole="header" aria-level={3}>
          Getting ready
        </Text>
        <PrepRow
          icon="luggage"
          label={liveItems.length > 0 ? `Packed ${packed}/${liveItems.length}` : 'Packing list not started'}
          ok={liveItems.length > 0 && packed === liveItems.length}
          onPress={openPacking}
        />
        <PrepRow
          icon="file-text"
          label={docCount === 1 ? '1 document saved' : `${docCount} documents saved`}
          ok={docCount > 0}
          onPress={openTrip}
        />
        <PrepRow
          icon="map-pin"
          label={firstNight ? `First night: ${firstNight.name}` : 'No stay booked for the first night'}
          ok={Boolean(firstNight)}
          onPress={openTrip}
        />
        {firstDay ? (
          <PrepRow
            icon="sun"
            label={`Day 1: ${weatherEmoji(firstDay.weatherCode)} ${weatherLabel(firstDay.weatherCode)}, high ${Math.round(firstDay.tMaxC)}°`}
            ok
            onPress={openTrip}
          />
        ) : null}
        {firstDay ? (
          <Text style={[t.typography.small, { color: t.colors.attribution }]}>Weather data by Open-Meteo.com</Text>
        ) : null}
      </View>

      <Button
        label="Open trip"
        variant="secondary"
        fullWidth={false}
        onPress={openTrip}
        accessibilityLabel={`Open ${trip.title}`}
      />
    </View>
  );
}

function PrepRow({ icon, label, ok, onPress }: { icon: IconName; label: string; ok: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}${ok ? '' : ', needs attention'}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.prepRow,
        { gap: t.spacing.md, opacity: pressed ? 0.7 : 1 },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
      ]}
    >
      <Icon name={icon} size={20} color={ok ? t.colors.success : t.colors.textMuted} />
      <Text style={[t.typography.body, styles.flex, { color: t.colors.text }]} numberOfLines={2}>
        {label}
      </Text>
      <Icon name="chevron-right" size={18} color={t.colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  prepRow: { flexDirection: 'row', alignItems: 'center', minHeight: MIN_TOUCH },
  flex: { flex: 1 },
});
