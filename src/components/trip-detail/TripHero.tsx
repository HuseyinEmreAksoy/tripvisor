/**
 * TripHero — the pieces of the trip cover hero (M5 Y2.4), split out of
 * TripHeader to keep both files readable:
 *   - CollapsingHero: the phone hero ⇄ one-line bar (animated height, reduced
 *     motion respected, one visible title in the a11y tree);
 *   - GlassButton: a dark-glass button for use on the cover image;
 *   - RouteChipRow: places · travel time · distance chips + a status pill;
 *   - heroTextStyle: the white-on-photo text shadow.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Icon, type IconName } from '@/components/Icon';
import { TripCover } from '@/components/TripCover';
import { useTheme, type Theme } from '@/theme';
import { formatDuration, formatNumber, useT } from '@/i18n';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import type { Trip, TripLeg } from '@/api';
import { HERO_COLLAPSE_DELTA } from './heroCollapse';

/** Collapsed bar height; the expanded hero adds HERO_COLLAPSE_DELTA. */
const BAR_HEIGHT = 60;
const HERO_HEIGHT = BAR_HEIGHT + HERO_COLLAPSE_DELTA;

/** White text on a cover photo: the theme's hero ink + a soft shadow. */
export function heroTextStyle(t: Theme): TextStyle {
  return {
    color: t.colors.heroChipText,
    textShadowColor: t.colors.heroOverlay,
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  };
}

/**
 * Phone hero ⇄ one-line bar. The back and ⋯ buttons stay put on the top
 * row; the big title block fades out while the height shrinks, and the bar
 * title fades in. Only the visible title is in the accessibility tree.
 */
export function CollapsingHero({
  trip,
  collapsed,
  phaseChip,
  dates,
  back,
  menu,
}: {
  trip: Trip;
  collapsed: boolean;
  phaseChip: ReactNode;
  dates: string;
  back: ReactNode;
  menu: ReactNode;
}) {
  const t = useTheme();
  const reducedMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(collapsed ? 1 : 0)).current;

  useEffect(() => {
    const to = collapsed ? 1 : 0;
    if (reducedMotion) {
      progress.setValue(to);
      return;
    }
    const anim = Animated.timing(progress, {
      toValue: to,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      // Height can't run on the native driver.
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [collapsed, reducedMotion, progress]);

  const height = progress.interpolate({ inputRange: [0, 1], outputRange: [HERO_HEIGHT, BAR_HEIGHT] });
  const bigOpacity = progress.interpolate({ inputRange: [0, 0.5], outputRange: [1, 0], extrapolate: 'clamp' });
  const barOpacity = progress.interpolate({ inputRange: [0.5, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  // The faded-out title block leaves the a11y tree on every platform.
  const hidden = {
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants' as const,
    'aria-hidden': true,
  };

  return (
    <Animated.View style={{ height, overflow: 'hidden' }}>
      <TripCover
        tripId={trip.id}
        coverPlaceId={trip.cover_photo_google_place_id}
        photoWidth={800}
        scrim="hero"
        style={StyleSheet.absoluteFill}
      >
        {/* Heavier wash under the bar once collapsed: the bar's small white
            text sits where the hero scrim is lightest. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: t.colors.heroScrim, opacity: barOpacity, pointerEvents: 'none' }]}
        />
        <Animated.View
          style={[
            styles.bigBlock,
            { left: t.spacing.lg, right: t.spacing.lg, bottom: t.spacing.lg, gap: t.spacing.xs, opacity: bigOpacity },
            collapsed && { pointerEvents: 'none' },
          ]}
          {...(collapsed ? hidden : {})}
        >
          {phaseChip}
          <Text
            accessibilityRole="header"
            aria-level={1}
            numberOfLines={2}
            style={[t.typography.title, heroTextStyle(t)]}
          >
            {trip.title}
          </Text>
          <Text numberOfLines={1} style={[t.typography.caption, heroTextStyle(t), styles.heroDates]}>
            {dates}
          </Text>
        </Animated.View>
        <View style={[styles.barRow, { height: BAR_HEIGHT, paddingHorizontal: t.spacing.lg, gap: t.spacing.sm }]}>
          {back}
          <Animated.View style={{ flex: 1, minWidth: 0, opacity: barOpacity }}>
            {collapsed ? (
              <>
                <Text
                  accessibilityRole="header"
                  aria-level={1}
                  numberOfLines={1}
                  style={[t.typography.bodyStrong, heroTextStyle(t), { fontSize: 17 }]}
                >
                  {trip.title}
                </Text>
                <Text numberOfLines={1} style={[t.typography.small, heroTextStyle(t)]}>
                  {dates}
                </Text>
              </>
            ) : null}
          </Animated.View>
          {menu}
        </View>
      </TripCover>
    </Animated.View>
  );
}

/** A dark-glass button for use on the cover image (icon, optional label). */
export function GlassButton({
  icon,
  label,
  accessibilityLabel,
  accessibilityHint,
  onPress,
}: {
  icon: IconName;
  label?: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.glassBtn,
        label ? { paddingHorizontal: t.spacing.md, gap: 6 } : { width: 44 },
        {
          backgroundColor: t.colors.heroGlass,
          borderColor: t.colors.heroChipBg,
          borderRadius: t.radius.pill,
          opacity: pressed ? 0.8 : 1,
        },
        Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
      ]}
    >
      <Icon name={icon} size={label ? 16 : 20} color={t.colors.heroChipText} />
      {label ? (
        <Text style={[t.typography.caption, { color: t.colors.heroChipText, fontWeight: '700', fontSize: 14 }]}>
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * Route totals as compact chips (day-assigned legs only — day_index -1 rows
 * are the optimizer's matrix cache, see TripCostRollup).
 */
export function RouteChipRow({
  legs,
  placesCount,
  statusPill,
}: {
  legs: TripLeg[];
  placesCount: number;
  statusPill: ReactNode;
}) {
  const t = useTheme();
  const { t: tx } = useT(['trip', 'common']);
  // F3 fix: on phones the status pill (e.g. "daily route limit reached") gets
  // its own line — as the last item of an indicator-less horizontal scroller
  // it sat off-screen at 375–390px.
  const pillOnOwnLine = useBreakpoint() === 'mobile';
  const totals = useMemo(() => {
    const routeLegs = legs.filter((l) => l.day_index >= 0);
    if (routeLegs.length === 0) return null;
    return {
      minutes: Math.round(routeLegs.reduce((s, l) => s + l.duration_seconds, 0) / 60),
      km: routeLegs.reduce((s, l) => s + l.distance_meters, 0) / 1000,
    };
  }, [legs]);

  const chips: Array<{ key: string; icon: IconName; label: string; a11y: string }> = [
    {
      key: 'stops',
      icon: 'map-pin',
      label: tx('route.places', { count: placesCount }),
      a11y: tx('route.places', { count: placesCount }),
    },
  ];
  if (totals) {
    const duration = formatDuration(totals.minutes);
    const km = formatNumber(totals.km, { maximumFractionDigits: 0 });
    chips.push(
      { key: 'time', icon: 'clock', label: duration, a11y: tx('route.timeA11y', { value: duration }) },
      {
        key: 'km',
        icon: 'compass',
        label: tx('common:units.kilometers', { value: km }),
        a11y: tx('route.distanceA11y', { value: km }),
      },
    );
  }

  const row = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: t.spacing.sm, alignItems: 'center' }}
      accessibilityLabel={tx('route.summary')}
    >
      {chips.map((c) => (
        <View
          key={c.key}
          accessible
          accessibilityLabel={c.a11y}
          style={[
            styles.chip,
            {
              backgroundColor: t.colors.bgElevated,
              borderColor: t.colors.border,
              borderRadius: t.radius.pill,
            },
          ]}
        >
          <Icon name={c.icon} size={14} color={t.colors.textMuted} />
          <Text style={[t.typography.caption, { color: t.colors.text, fontWeight: '600' }]}>{c.label}</Text>
        </View>
      ))}
      {pillOnOwnLine ? null : statusPill}
    </ScrollView>
  );
  if (!pillOnOwnLine || !statusPill) return row;
  return (
    <View style={{ gap: t.spacing.xs }}>
      {row}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{statusPill}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bigBlock: { position: 'absolute' },
  barRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroDates: { fontSize: 14, fontWeight: '600' },
  glassBtn: {
    height: 44,
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
