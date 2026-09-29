/**
 * HomeHero — travel-feel hero band for the Home surface (v2 Phase N1 step 1.3,
 * restyled in the v2 "Tide & Terracotta" redesign).
 *
 * Rendered at the top of app/(app)/trips.tsx (active tab only): destination
 * imagery + headline, the primary "✨ Plan my trip with AI" CTA (routes to
 * /trip/plan), and a trip-countdown chip ("✈️ 5 days to Lisbon") for the
 * nearest future trip, hidden when none.
 *
 * Visual language: tall rounded card (radius.xl), photo with a layered
 * two-step scrim (soft wash + darker bottom band) for text legibility, muted
 * uppercase overline, big display headline, and a white pill CTA that reads
 * as the floating primary action over imagery in both themes.
 *
 * Imagery follows the auth screens' pattern: bundled brand photo (assets/images/hero-home.jpg), decorative
 * (hidden from the a11y tree), color placeholder while loading.
 *
 * Desktop (≥1024px): the parent constrains width to the centred 1200px
 * container; the hero grows taller and lays the CTA + countdown side by side.
 *
 * Phones (<768px, M4 X1.1): a COMPACT card — shorter, no body sentence,
 * smaller headline — that scrolls away with the trips list so the first trip
 * card is visible without scrolling.
 */
import { StyleSheet, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useTheme } from '@/theme';
import { useRouter, type Href } from 'expo-router';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { activeTripsOn } from '@/lib/tripToday';
import type { Trip } from '@/api';

// Cobbled old-town evening — distinct from the login/signup heroes.
// Bundled brand art (generated 2026-09-28) — offline-safe and COEP-safe, unlike a hotlink.
// The (tabs)/today route is new in M4; the checked-in typed-routes file predates
// it, so the literal is widened once here (regenerated types accept it as-is).
const TODAY_HREF = '/today' as Href;

const HERO_SOURCE = require('../../../assets/images/hero-home.jpg');

export interface HomeHeroProps {
  /** Active trips (owned + shared) — countdown picks the nearest future start_date. */
  trips: Trip[];
  onPlanWithAI: () => void;
  onOpenTrip: (tripId: string) => void;
}

interface Countdown {
  tripId: string;
  title: string;
  daysUntil: number; // 0 = starts today
}

/**
 * Nearest trip with start_date >= today (local). Exported for unit tests.
 * Dates are stored as 'YYYY-MM-DD'; constructing from parts avoids the
 * UTC-midnight off-by-one of `new Date('YYYY-MM-DD')`.
 */
export function findNextTrip(trips: ReadonlyArray<Trip>, now: Date = new Date()): Countdown | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let best: Countdown | null = null;
  for (const trip of trips) {
    if (!trip.start_date) continue;
    const [y, m, d] = trip.start_date.split('-').map(Number);
    if (!y || !m || d === undefined) continue;
    const start = new Date(y, m - 1, d);
    const daysUntil = Math.round((start.getTime() - today.getTime()) / 86400000);
    if (daysUntil < 0) continue;
    if (best === null || daysUntil < best.daysUntil) {
      best = { tripId: trip.id, title: trip.title, daysUntil };
    }
  }
  return best;
}

function countdownLabel(c: Countdown): string {
  if (c.daysUntil === 0) return `✈️ ${c.title} starts today!`;
  if (c.daysUntil === 1) return `✈️ 1 day to ${c.title}`;
  return `✈️ ${c.daysUntil} days to ${c.title}`;
}

export function HomeHero({ trips, onPlanWithAI, onOpenTrip }: HomeHeroProps) {
  const t = useTheme();
  const bp = useBreakpoint();
  const isDesktop = bp === 'desktop';
  const compact = bp === 'mobile';
  const next = findNextTrip(trips);
  const router = useRouter();
  // M4 X2.1: a trip running today gets a shortcut into the Today tab.
  const live = activeTripsOn(trips)[0];

  return (
    <View
      style={[
        styles.card,
        {
          borderRadius: t.radius.xl,
          minHeight: isDesktop ? 260 : compact ? 164 : 208,
          ...t.shadows.lg(t.colors.shadowColorStrong),
        },
      ]}
    >
      <Image
        source={HERO_SOURCE}
        style={[StyleSheet.absoluteFillObject, { backgroundColor: '#16332E' }]}
        contentFit="cover"
        accessibilityElementsHidden
        importantForAccessibility="no"
        aria-hidden
        transition={400}
      />
      {/* Layered scrim: a soft full wash + a heavier bottom band — fakes a
          vertical gradient with plain Views (no new deps). Decorative. */}
      <View
        style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(12, 10, 8, 0.22)' }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
        aria-hidden
      />
      <View
        style={[styles.scrimBottom, { backgroundColor: t.colors.heroOverlay }]}
        accessibilityElementsHidden
        importantForAccessibility="no"
        aria-hidden
      />

      <View style={[styles.copy, { padding: isDesktop ? t.spacing.xl : t.spacing.lg, gap: compact ? t.spacing.xs : t.spacing.sm }]}>
        {live ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${live.title} is live. Open Today.`}
            onPress={() => router.push(TODAY_HREF)}
            style={({ pressed }) => [
              styles.liveBanner,
              {
                backgroundColor: t.colors.heroChipBg,
                borderRadius: t.radius.pill,
                paddingHorizontal: t.spacing.md,
                gap: t.spacing.sm,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <View style={[styles.liveDot, { backgroundColor: t.colors.success }]} />
            <Text style={[t.typography.bodyStrong, { color: '#FFFFFF', fontSize: 14 }]} numberOfLines={1}>
              Your trip is live → Today
            </Text>
          </Pressable>
        ) : null}
        {/* Brand is pre-uppercased with CSS uppercase OFF: under lang=tr the
            browser maps i→İ ("TRİPVİSOR"). */}
        <Text style={[t.typography.overline, { color: 'rgba(255,255,255,0.85)', textTransform: 'none' }]}>
          TRIPVISOR
        </Text>
        <Text
          style={[
            styles.headline,
            {
              color: '#FFFFFF',
              fontSize: isDesktop ? 34 : compact ? 23 : 27,
              lineHeight: isDesktop ? 40 : compact ? 29 : 33,
            },
          ]}
          accessibilityRole="header"
          aria-level={2}
        >
          Plan your next adventure
        </Text>
        {compact ? null : (
          <Text style={[t.typography.body, { color: 'rgba(255,255,255,0.92)', maxWidth: 460 }]}>
            Describe your dream trip and let AI draft the plan.
          </Text>
        )}

        {/* CTA + countdown — row on desktop, stacked on mobile */}
        <View style={[styles.actionsRow, { gap: t.spacing.sm, flexDirection: isDesktop ? 'row' : 'column', alignItems: isDesktop ? 'center' : 'stretch' }]}>
          {/* White pill: the floating primary action over imagery, both themes. */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Plan my trip with AI"
            onPress={onPlanWithAI}
            style={({ pressed }) => [
              styles.cta,
              {
                backgroundColor: pressed ? '#EDE7DC' : '#FFFFFF',
                borderRadius: t.radius.pill,
                paddingHorizontal: t.spacing.xl,
                ...t.shadows.md('rgba(0, 0, 0, 0.35)'),
              },
            ]}
          >
            <Text style={[t.typography.bodyStrong, { color: '#221E18', letterSpacing: 0.2 }]}>
              ✨ Plan my trip with AI
            </Text>
          </Pressable>

          {next ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${countdownLabel(next).replace('✈️ ', '')}. Open trip.`}
              onPress={() => onOpenTrip(next.tripId)}
              style={({ pressed }) => [
                styles.countdownChip,
                {
                  backgroundColor: t.colors.heroChipBg,
                  borderColor: 'rgba(255,255,255,0.35)',
                  borderRadius: t.radius.pill,
                  paddingHorizontal: t.spacing.lg,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={[t.typography.bodyStrong, { color: '#FFFFFF', fontSize: 14 }]}
                numberOfLines={1}
              >
                {countdownLabel(next)}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  scrimBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '72%',
  },
  copy: {
    justifyContent: 'flex-end',
  },
  headline: {
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  actionsRow: {
    marginTop: 6,
  },
  cta: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  liveBanner: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    maxWidth: 360,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  countdownChip: {
    minHeight: 40,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    maxWidth: 360,
  },
});
