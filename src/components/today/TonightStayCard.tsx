/**
 * TonightStayCard — where the traveller sleeps tonight (v2 M4 X2.1), with a
 * one-tap "Navigate home". Coverage uses the StayingAtPill rule
 * (check_in ≤ tonight < check_out) via `staysForNight`.
 */
import { StyleSheet, Text, View } from 'react-native';
import type { TripAccommodation } from '@/api/types';
import { useTheme } from '@/theme';
import { TodayAction } from './TodayAction';
import { useTodayCardStyle } from './todayStyles';

export interface TonightStayCardProps {
  stays: ReadonlyArray<TripAccommodation>;
  /** Null when neither coordinates nor an address exist for the first stay. */
  onNavigateHome: ((stay: TripAccommodation) => void) | null;
  /** Local 'YYYY-MM-DD' of tonight, for the "checks out" hint. */
  tonight: string;
}

export function TonightStayCard({ stays, onNavigateHome, tonight }: TonightStayCardProps) {
  const t = useTheme();
  const card = useTodayCardStyle();
  const stay = stays[0];

  return (
    <View style={card}>
      <Text style={[t.typography.overline, { color: t.colors.textMuted }]}>Tonight's stay</Text>
      {stay ? (
        <>
          <Text
            style={[t.typography.subtitle, { color: t.colors.text }]}
            accessibilityRole="header"
            aria-level={2}
            numberOfLines={2}
          >
            {`🏨 ${stay.name}${stays.length > 1 ? ` +${stays.length - 1}` : ''}`}
          </Text>
          {stay.address ? (
            <Text style={[t.typography.caption, { color: t.colors.textMuted }]} numberOfLines={2}>
              {stay.address}
            </Text>
          ) : null}
          <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>
            {checkoutHint(stay.check_out_date, tonight)}
          </Text>
          {onNavigateHome && (stay.lat != null || stay.address) ? (
            <View style={styles.row}>
              <TodayAction
                label="Navigate home"
                icon="compass"
                onPress={() => onNavigateHome(stay)}
                accessibilityLabel={`Navigate to ${stay.name}`}
                accessibilityHint="Opens directions in your maps app"
              />
            </View>
          ) : null}
        </>
      ) : (
        <Text style={[t.typography.body, { color: t.colors.textMuted }]}>
          No stay booked for tonight.
        </Text>
      )}
    </View>
  );
}

/** "Checks out tomorrow" / "Checks out 2026-10-03". */
function checkoutHint(checkOut: string, tonight: string): string {
  const [y, m, d] = tonight.split('-').map(Number);
  if (y && m && d) {
    const next = new Date(y, m - 1, d + 1);
    const tomorrow = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    if (checkOut === tomorrow) return 'Checks out tomorrow';
  }
  return `Checks out ${checkOut}`;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap' },
});
