/**
 * TripHubCards — building blocks for TripHubTab + TripSettingsSheet
 * (v2 M4 X2.2).
 *
 *   HubCard               — tappable summary card. Either expands its
 *                           children inline (accordion) or navigates.
 *   ProgressBar           — thin themed bar (budget spent, packing X/Y).
 *   ReactionCatalogSection— the "You liked / didn't like" list, moved
 *                           verbatim from the old SettingsTab.
 *   SectionHeading        — the old SettingsTab inline heading.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from '@/components';
import { dayColor } from '@/components/Map/types';
import { useTheme } from '@/theme';
import type { TripPlace } from '@/api';

// Day palette colors are fixed (not themed) and designed for white labels —
// same foreground as DayPicker / the v1 catalog chips.
const ON_DAY_COLOR = '#FFFFFF';

export interface HubCardProps {
  icon: IconName;
  title: string;
  /** One-line summary shown under the title (e.g. "€320 of €800"). */
  summary: string;
  /** Screen-reader name; defaults to `${title}, ${summary}`. */
  accessibilityLabel?: string;
  onPress: () => void;
  /** Accordion cards pass their open state; link cards omit it. */
  expanded?: boolean;
  /** Extra visual under the summary (progress bar, avatars). */
  accessory?: ReactNode;
  /** Revealed below the card while `expanded`. */
  children?: ReactNode;
}

export function HubCard({
  icon,
  title,
  summary,
  accessibilityLabel,
  onPress,
  expanded,
  accessory,
  children,
}: HubCardProps) {
  const t = useTheme();
  const isAccordion = expanded !== undefined;
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.lg,
          ...t.shadows.sm(t.colors.shadowColor),
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? `${title}, ${summary}`}
        accessibilityState={isAccordion ? { expanded } : undefined}
        onPress={onPress}
        style={({ pressed }) => [
          styles.cardHead,
          {
            padding: t.spacing.md,
            borderRadius: t.radius.lg,
            backgroundColor: pressed ? t.colors.gradientSubtle : 'transparent',
          },
        ]}
      >
        <View
          style={[
            styles.iconWrap,
            { backgroundColor: t.colors.gradientSubtle, borderRadius: t.radius.md },
          ]}
        >
          <Icon name={icon} size={20} color={t.colors.primary} />
        </View>
        <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
          <Text style={[t.typography.bodyStrong, { color: t.colors.text }]}>{title}</Text>
          <Text numberOfLines={2} style={[t.typography.caption, { color: t.colors.textMuted }]}>
            {summary}
          </Text>
          {accessory}
        </View>
        <View style={isAccordion && expanded ? styles.chevronOpen : undefined}>
          <Icon name="chevron-right" size={18} color={t.colors.textMuted} />
        </View>
      </Pressable>
      {isAccordion && expanded && children ? (
        <View style={{ paddingHorizontal: t.spacing.md, paddingBottom: t.spacing.md, gap: t.spacing.md }}>
          {children}
        </View>
      ) : null}
    </View>
  );
}

/** Thin progress bar; `value` is clamped to 0..1. `over` tints it danger. */
export function ProgressBar({ value, over = false }: { value: number; over?: boolean }) {
  const t = useTheme();
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.track, { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.pill }]}
    >
      <View
        style={{
          width: `${Math.round(pct * 100)}%`,
          height: '100%',
          borderRadius: t.radius.pill,
          backgroundColor: over ? t.colors.danger : t.colors.primary,
        }}
      />
    </View>
  );
}

/** Small inline section heading (moved from the old SettingsTab). */
export function SectionHeading({ label }: { label: string }) {
  const t = useTheme();
  return (
    <Text
      style={[t.typography.subtitle, { color: t.colors.text }]}
      accessibilityRole="header"
      aria-level={3}
    >
      {label}
    </Text>
  );
}

/**
 * Liked / disliked catalog section (Phase 24 Step 24.5) — moved from the old
 * SettingsTab. Renders nothing when empty (same as v1).
 * X2.2: rows open place detail WITH trip context so the reaction can be
 * changed right there.
 */
export function ReactionCatalogSection({
  label,
  places,
  onOpenPlace,
}: {
  label: string;
  places: TripPlace[];
  onOpenPlace: (place: TripPlace) => void;
}) {
  const t = useTheme();
  if (places.length === 0) return null;
  return (
    <>
      <SectionHeading label={label} />
      {places.map((place) => (
        <Pressable
          key={place.id}
          accessibilityRole="button"
          accessibilityLabel={`View details for ${place.user_title ?? 'place'}`}
          onPress={() => onOpenPlace(place)}
          style={({ pressed }) => [
            {
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: pressed ? t.colors.gradientSubtle : t.colors.bgElevated,
              borderColor: t.colors.border,
              borderRadius: t.radius.md,
              borderWidth: 1,
              padding: t.spacing.md,
              gap: t.spacing.sm,
            },
          ]}
        >
          <Text style={[t.typography.body, { color: t.colors.text, flex: 1 }]} numberOfLines={1}>
            {place.user_title ?? 'Unknown place'}
          </Text>
          {place.day_index !== null ? (
            <View
              style={{
                backgroundColor: dayColor(place.day_index),
                borderRadius: t.radius.pill,
                paddingHorizontal: t.spacing.sm,
                paddingVertical: 2,
              }}
            >
              <Text style={[t.typography.small, { color: ON_DAY_COLOR }]}>
                {`Day ${place.day_index + 1}`}
              </Text>
            </View>
          ) : null}
          <Icon name="chevron-right" size={14} color={t.colors.textMuted} />
        </Pressable>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64 },
  iconWrap: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  chevronOpen: { transform: [{ rotate: '90deg' }] },
  track: { height: 6, width: '100%', overflow: 'hidden', marginTop: 2 },
});
