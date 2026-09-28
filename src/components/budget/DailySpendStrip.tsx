/**
 * DailySpendStrip — per-day ACTUAL spend as a row of mini bars (v2 M4 X2.4).
 *
 * One column per trip day (bar height ∝ that day's spend, label "Mon 12" or
 * "D3"), plus a "Trip" column for spend not pinned to a day. Today is ringed.
 * Tapping a column selects it (radio) so the parent can filter the list;
 * tapping the selected column again clears the filter.
 *
 * Only ACTUAL rows count — estimates are plans. Category-based budgeting
 * only; nothing here is distance-based.
 */
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { formatCurrency } from '@/lib/formatCurrency';
import { haptics } from '@/lib/haptics';
import { shortDayLabel, type DailySpend } from './expenseMath';

/** Selected filter: a day index, 'trip' (unpinned), or null (all). */
export type SpendFilter = number | 'trip' | null;

export interface DailySpendStripProps {
  spend: DailySpend;
  currency?: string | null;
  tripStartDate?: string | null;
  todayIndex?: number | null;
  selected: SpendFilter;
  onSelect: (next: SpendFilter) => void;
}

const BAR_MAX = 44;

export function DailySpendStrip({ spend, currency, tripStartDate, todayIndex, selected, onSelect }: DailySpendStripProps) {
  const t = useTheme();
  const fmt = (n: number) => formatCurrency(n, currency);
  const scale = Math.max(spend.max, spend.unassigned, 1);

  const columns: Array<{ key: SpendFilter; label: string; a11y: string; amount: number; today: boolean }> = [
    ...spend.days.map((amount, i) => {
      const dated = shortDayLabel(tripStartDate, i);
      return {
        key: i as SpendFilter,
        label: tripStartDate ? dated : `D${i + 1}`,
        a11y: `Day ${i + 1}${tripStartDate ? `, ${dated}` : ''}${i === todayIndex ? ', today' : ''}: ${fmt(amount)} spent`,
        amount,
        today: i === todayIndex,
      };
    }),
  ];
  if (spend.unassigned > 0) {
    columns.push({ key: 'trip', label: 'Trip', a11y: `Whole trip: ${fmt(spend.unassigned)} spent`, amount: spend.unassigned, today: false });
  }

  return (
    <View style={{ gap: t.spacing.xs }}>
      <View style={[styles.headRow]}>
        <Text style={[t.typography.overline, { color: t.colors.textMuted }]}>Spend by day</Text>
        {spend.averagePerActiveDay > 0 ? (
          <Text style={[t.typography.small, { color: t.colors.textMuted }]}>
            avg {fmt(spend.averagePerActiveDay)}/day
          </Text>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="radiogroup"
        accessibilityLabel="Filter expenses by day"
        contentContainerStyle={{ gap: t.spacing.xs, alignItems: 'flex-end' }}
      >
        {columns.map((col) => {
          const isSelected = selected === col.key;
          const h = col.amount > 0 ? Math.max(4, Math.round((col.amount / scale) * BAR_MAX)) : 2;
          return (
            <Pressable
              key={String(col.key)}
              accessibilityRole="radio"
              accessibilityLabel={col.a11y}
              accessibilityState={{ checked: isSelected }}
              onPress={() => {
                haptics.select();
                onSelect(isSelected ? null : col.key);
              }}
              style={({ pressed }) => [
                styles.col,
                {
                  borderRadius: t.radius.md,
                  borderColor: isSelected ? t.colors.primary : col.today ? t.colors.borderStrong : 'transparent',
                  backgroundColor: isSelected ? t.colors.gradientSubtle : pressed ? t.colors.bgMuted : 'transparent',
                },
                Platform.OS === 'web' && ({ cursor: 'pointer' } as ViewStyle),
              ]}
            >
              <View style={[styles.barArea]}>
                <View
                  style={{
                    width: 14,
                    height: h,
                    borderRadius: t.radius.sm,
                    backgroundColor: col.amount > 0 ? t.colors.primary : t.colors.border,
                  }}
                />
              </View>
              <Text
                style={[
                  t.typography.small,
                  { color: col.today ? t.colors.primaryInk : t.colors.textMuted, fontWeight: col.today ? '700' : '500' },
                ]}
                numberOfLines={1}
              >
                {col.today ? 'Today' : col.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  col: { minWidth: 48, minHeight: 72, paddingVertical: 4, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'flex-end', gap: 4, borderWidth: 1.5 },
  barArea: { height: BAR_MAX, justifyContent: 'flex-end' },
});
