/**
 * Insights (analytics tab) building blocks, extracted from the screen in
 * X3.1 to keep it under the 500-line cap:
 *   - ChartCard        — elevated titled card holding one chart or catalog
 *   - PlaceCatalogRow  — "most liked / didn't like" row with an icon badge
 *   - ReactionLegend   — liked / didn't-like key for the paired bar chart
 *   - InsightsSkeleton — loading placeholder shaped like the chart stack
 *   - categoryColor    — theme-aware category palette (tokens, both themes)
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { Skeleton, SkeletonGroup } from '@/components/Skeleton';
import { useTheme, type Theme } from '@/theme';
import type { TripExpenseCategory } from '@/api/types';

export function categoryColor(t: Theme, category: TripExpenseCategory): string {
  switch (category) {
    case 'accommodation':
      return t.colors.chartAccommodation;
    case 'food':
      return t.colors.chartFood;
    case 'transport':
      return t.colors.chartTransport;
    case 'shopping':
      return t.colors.chartShopping;
    case 'activities':
      return t.colors.chartActivities;
    default:
      return t.colors.chartOther;
  }
}

export function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.colors.bgElevated,
          borderColor: t.colors.border,
          borderRadius: t.radius.lg,
          padding: t.spacing.lg,
          gap: t.spacing.md,
          ...t.shadows.sm(t.colors.shadowColor),
        },
      ]}
    >
      <Text
        style={[t.typography.subtitle, { color: t.colors.text }]}
        accessibilityRole="header"
        aria-level={2}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

export function PlaceCatalogRow({
  title,
  tripTitle,
  dayIndex,
  count,
  kind,
}: {
  title: string;
  tripTitle: string;
  dayIndex: number | null;
  count: number;
  kind: 'liked' | 'disliked';
}) {
  const t = useTheme();
  const verb = kind === 'liked' ? 'liked' : "didn't like";
  return (
    <View
      style={[styles.catalogRow, { borderBottomColor: t.colors.border }]}
      accessible
      accessibilityLabel={`${title}, ${tripTitle}${
        dayIndex !== null ? `, day ${dayIndex + 1}` : ''
      }. ${verb} ${count} ${count === 1 ? 'time' : 'times'}`}
    >
      <View style={styles.catalogText}>
        <Text style={[t.typography.bodyStrong, { color: t.colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[t.typography.caption, { color: t.colors.textMuted }]} numberOfLines={1}>
          {tripTitle}
          {dayIndex !== null ? ` · Day ${dayIndex + 1}` : ''}
        </Text>
      </View>
      <View
        style={[
          styles.catalogBadge,
          { backgroundColor: t.colors.bgMuted, borderRadius: t.radius.pill },
        ]}
      >
        <Icon
          name={kind === 'liked' ? 'thumbs-up' : 'thumbs-down'}
          size={14}
          color={kind === 'liked' ? t.colors.success : t.colors.danger}
        />
        <Text style={[t.typography.caption, { color: t.colors.text }]}>{count}</Text>
      </View>
    </View>
  );
}

export function ReactionLegend() {
  const t = useTheme();
  const item = (color: string, icon: 'thumbs-up' | 'thumbs-down', label: string) => (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color }]} />
      <Icon name={icon} size={14} color={t.colors.textMuted} />
      <Text style={[t.typography.caption, { color: t.colors.textMuted }]}>{label}</Text>
    </View>
  );
  return (
    <View style={styles.legend}>
      {item(t.colors.success, 'thumbs-up', 'Liked')}
      {item(t.colors.danger, 'thumbs-down', "Didn't like")}
    </View>
  );
}

export function InsightsSkeleton() {
  const t = useTheme();
  return (
    <SkeletonGroup label="Loading insights" style={{ gap: t.spacing.lg }}>
      <Skeleton height={240} radius="lg" />
      <Skeleton height={200} radius="lg" />
      <Skeleton height={160} radius="lg" />
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1 },
  catalogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  catalogText: { flex: 1, gap: 2 },
  catalogBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 10, height: 10, borderRadius: 3 },
});
