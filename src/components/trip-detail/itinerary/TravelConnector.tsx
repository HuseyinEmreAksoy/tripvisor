/**
 * TravelConnector — the leg line between two place cards.
 *
 * v2 M4 X2.3: extracted from PlaceRow; the transit "Plan transit ↗" link
 * goes to the NEXT stop (origin = this stop), hidden without one.
 * v2 P1.2: transit legs name their rides ("M2 → U1").
 *
 * M5 Y3.3 (per-leg modes): the line leads with a LEG CHIP — mode icon +
 * duration, "≈" when the duration is an estimate (or the stored leg was
 * computed for a mode the user has since changed). For editors the chip is
 * a button that opens the leg-mode sheet; viewers get the same chip as
 * plain text. The chip model (mode, minutes, estimated…) is prebuilt by
 * `buildLegChipModel` so this component does no routing logic.
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { formatDistance, formatDuration, useT } from '@/i18n';
import { Icon } from '@/components/Icon';
import { openDirections, type DirectionsPoint } from '@/lib/directions';
import { haptics } from '@/lib/haptics';
import type { TripLeg } from '@/api/types';
import { LEG_MODE_ICON, type LegChipModel } from './legModes';

export interface TravelConnectorProps {
  legAfter: TripLeg | undefined;
  model: LegChipModel;
  /** This stop — the directions origin. */
  from: DirectionsPoint;
  /** The next stop in the day — the directions destination. */
  to: DirectionsPoint | null | undefined;
  /** Editors: opens the leg-mode sheet. Absent → the chip is read-only. */
  onEditMode?: () => void;
}

export function TravelConnector({ legAfter, model, from, to, onEditMode }: TravelConnectorProps) {
  const t = useTheme();
  const { t: tx } = useT('routes');
  const modeLabel = tx(`mode.${model.mode}`);
  const duration = model.minutes !== null ? formatDuration(model.minutes) : null;
  const durationText =
    duration === null ? '—' : model.estimated ? tx('leg.approx', { duration }) : duration;
  const nextLabel = to?.label ?? tx('leg.nextStop');

  const lineNames =
    model.mode === 'transit' && legAfter && !model.stale
      ? (legAfter.transit_steps ?? [])
          .filter((s) => s.travelMode === 'TRANSIT' && s.lineName)
          .map((s) => s.lineName as string)
      : [];

  const spoken =
    duration === null
      ? tx('leg.a11yUnknown', { mode: modeLabel })
      : model.estimated
        ? tx('leg.a11yEstimated', { mode: modeLabel, duration })
        : model.userTimed
          ? tx('leg.a11yUserTimed', { mode: modeLabel, duration })
          : tx('leg.a11y', { mode: modeLabel, duration });

  const chipBody = (
    <>
      <Icon name={LEG_MODE_ICON[model.mode]} size={13} color={t.colors.primaryInk} />
      <Text style={[t.typography.caption, { color: t.colors.primaryInk, fontWeight: '700' }]}>
        {durationText}
      </Text>
      {onEditMode ? <Icon name="chevron-right" size={12} color={t.colors.primaryInk} /> : null}
    </>
  );
  const chipStyle = [
    styles.chip,
    {
      backgroundColor: t.colors.bgMuted,
      borderRadius: t.radius.pill,
      borderColor: model.overridden ? t.colors.primary : t.colors.border,
    },
  ];

  return (
    <View style={[styles.row, { gap: t.spacing.xs }]}>
      <Icon name="arrow-right" size={12} color={t.colors.textMuted} />
      {onEditMode ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={spoken}
          accessibilityHint={tx('leg.editHint', { place: nextLabel })}
          onPress={() => {
            haptics.tap();
            onEditMode();
          }}
          // 28pt chip + 8pt vertical slop ≥ 44pt target.
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          style={({ pressed }) => [
            ...chipStyle,
            { opacity: pressed ? 0.7 : 1 },
            Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
          ]}
        >
          {chipBody}
        </Pressable>
      ) : (
        <View style={chipStyle} accessible accessibilityLabel={spoken}>
          {chipBody}
        </View>
      )}
      {model.distanceMeters !== null && model.distanceMeters > 0 ? (
        <Text
          style={[t.typography.small, { color: t.colors.textMuted }]}
          importantForAccessibility="no"
          accessibilityElementsHidden
        >
          {formatDistance(model.distanceMeters)}
        </Text>
      ) : null}
      {lineNames.length > 0 ? (
        <Text
          style={[t.typography.small, { color: t.colors.textMuted }]}
          accessibilityLabel={tx('leg.transitLinesA11y', { lines: lineNames.join(', ') })}
        >
          {lineNames.join(' → ')}
        </Text>
      ) : null}
      {model.mode === 'transit' && to ? (
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={tx('leg.planTransitA11y', { place: nextLabel })}
          onPress={() => {
            haptics.tap();
            void openDirections({ origin: from, destination: to, mode: 'transit' });
          }}
          // ≥44pt target on a single line of small text.
          hitSlop={{ top: 14, bottom: 14, left: 6, right: 6 }}
        >
          <Text style={[t.typography.small, { color: t.colors.primaryInk, fontWeight: '600' }]}>
            {tx('leg.planTransit')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 28,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderWidth: 1,
  },
});
