/**
 * TripStatusChip — "Day 3 of 7" / "In 12 days" / "Relive" (M5 Y2.4).
 * Two tones: `onImage` (dark glass over a cover photo, white text — AA per
 * the token contrast test) and `surface` (tinted chip on the page).
 * Renders nothing for undated trips.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { useT } from '@/i18n';
import { Icon } from './Icon';
import { PHASE_ICON, type TripPhase } from './tripStatus';

export function useTripPhaseLabel(phase: TripPhase): string | null {
  const { t: tx } = useT('trip');
  switch (phase.kind) {
    case 'live':
      return tx('status.live', { day: phase.day, total: phase.total });
    case 'upcoming':
      return tx('status.upcoming', { count: phase.daysUntil });
    case 'past':
      return tx('status.past');
    default:
      return null;
  }
}

export function TripStatusChip({
  phase,
  tone = 'surface',
}: {
  phase: TripPhase;
  tone?: 'onImage' | 'surface';
}) {
  const t = useTheme();
  const { t: tx } = useT('trip');
  const label = useTripPhaseLabel(phase);
  if (!label || phase.kind === 'undated') return null;
  const onImage = tone === 'onImage';
  const live = phase.kind === 'live';
  const fg = onImage ? t.colors.heroChipText : live ? t.colors.primaryInk : t.colors.textMuted;
  return (
    <View
      accessible
      accessibilityLabel={tx('status.a11y', { status: label })}
      style={[
        styles.chip,
        {
          borderRadius: t.radius.pill,
          backgroundColor: onImage ? t.colors.heroGlass : live ? t.colors.gradientSubtle : t.colors.bgMuted,
        },
      ]}
    >
      {live ? (
        <View style={[styles.liveDot, { backgroundColor: onImage ? t.colors.success : t.colors.primary }]} />
      ) : (
        <Icon name={PHASE_ICON[phase.kind]} size={13} color={fg} />
      )}
      <Text style={[t.typography.caption, { color: fg, fontWeight: '700' }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minHeight: 26,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
});
