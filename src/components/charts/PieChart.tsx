/**
 * PieChart — thin wrapper around react-native-gifted-charts' PieChart.
 *
 * v2 Phase P3.1: replaces the hand-rolled SVG donut (same rationale as
 * BarChart.tsx — React 19 unblocked modern chart libs; gifted renders via
 * react-native-svg on all three platforms). Gradients stay disabled.
 *
 * The exported prop contract is byte-compatible with the v1 component:
 *   - data: Array<{ label: string; value: number; color: string }>
 *   - size?: donut diameter (default 180)
 *   - title?: caption above the chart
 *
 * The legend (color dot + label + percentage) is OURS, not gifted's — gifted
 * has no legend component, and the v1 layout (donut left, legend right,
 * wrapping) is preserved verbatim.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PieChart as GiftedPieChart, type pieDataItem } from 'react-native-gifted-charts';
import { useTheme } from '@/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface PieChartSlice {
  label: string;
  value: number;
  color: string;
}

interface PieChartProps {
  data: PieChartSlice[];
  size?: number;
  title?: string;
}

const DEFAULT_SIZE = 180;

export function PieChart({ data, size = DEFAULT_SIZE, title }: PieChartProps) {
  const t = useTheme();
  const reducedMotion = useReducedMotion();
  const r = size / 2;
  const innerR = r * 0.55; // donut hole — same ratio as v1

  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);

  const slices = useMemo(() => data.filter((d) => d.value > 0), [data]);

  const giftedData = useMemo<pieDataItem[]>(
    () => slices.map((s) => ({ value: s.value, color: s.color })),
    [slices],
  );

  // Screen-reader summary — slices themselves are not readable.
  const a11ySummary = useMemo(
    () =>
      `${title ?? 'Pie chart'}. ${slices
        .map((s) => `${s.label}: ${total > 0 ? Math.round((s.value / total) * 100) : 0}%`)
        .join(', ')}`,
    [title, slices, total],
  );

  if (total === 0 || slices.length === 0) {
    return (
      <View style={[styles.empty, { width: size, height: size }]}>
        <Text style={[t.typography.caption, { color: t.colors.textMuted, textAlign: 'center' }]}>
          No data
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container} accessible accessibilityLabel={a11ySummary}>
      {title ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted, marginBottom: 4 }]}>
          {title}
        </Text>
      ) : null}
      <View style={styles.row}>
        <GiftedPieChart
          data={giftedData}
          donut
          radius={r - 2}
          innerRadius={innerR}
          innerCircleColor={t.colors.bgElevated}
          isAnimated={!reducedMotion}
          animationDuration={600}
        />

        {/* Legend — ours, preserved from v1 */}
        <View style={styles.legend}>
          {slices.map((s, i) => (
            <View key={`legend-${i}`} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: s.color }]} />
              <Text style={[t.typography.small, { color: t.colors.textMuted, flex: 1 }]} numberOfLines={1}>
                {s.label}
              </Text>
              <Text style={[t.typography.small, { color: t.colors.text, fontWeight: '600' }]}>
                {Math.round((s.value / total) * 100)}%
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
  },
  legend: {
    flex: 1,
    gap: 6,
    minWidth: 120,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
