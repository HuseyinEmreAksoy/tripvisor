/**
 * LineChart — thin wrapper around react-native-gifted-charts' LineChart.
 *
 * v2 Phase P3.1: replaces the hand-rolled SVG polyline (same rationale as
 * BarChart.tsx — React 19 unblocked modern chart libs; gifted renders via
 * react-native-svg on all three platforms). Gradients stay disabled.
 *
 * The exported prop contract is byte-compatible with the v1 component:
 *   - data: Array<{ label: string; value: number }>
 *   - width / height: TOTAL footprint (caller measures via useWindowDimensions)
 *   - color?: line + data-point color (defaults to theme primary)
 *   - title?: caption above the chart
 *
 * Empty/short-data behavior preserved: <2 points renders the v1 placeholder
 * box ('No data' / 'Need at least 3 trips with dates').
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LineChart as GiftedLineChart, type lineDataItem } from 'react-native-gifted-charts';
import { useTheme } from '@/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface LineChartPoint {
  label: string;
  value: number;
}

interface LineChartProps {
  data: LineChartPoint[];
  width: number;
  height?: number;
  color?: string;
  title?: string;
}

// Same footprint budgeting as BarChart: gifted's y-axis gutter renders
// outside `width`, x-axis labels render below `height`.
const Y_AXIS_LABEL_WIDTH = 44;
const X_LABEL_SPACE = 56; // top headroom + one x-axis label row (old PADDING budget)
const DEFAULT_HEIGHT = 180;

function compactNumber(label: string): string {
  const n = Number(label);
  if (!Number.isFinite(n)) return label;
  return n > 999 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}

export function LineChart({
  data,
  width,
  height = DEFAULT_HEIGHT,
  color,
  title,
}: LineChartProps) {
  const t = useTheme();
  const reducedMotion = useReducedMotion();
  const lineColor = color ?? t.colors.primary;

  const plotW = Math.max(80, width - Y_AXIS_LABEL_WIDTH);
  const plotH = Math.max(60, height - X_LABEL_SPACE);

  const giftedData = useMemo<lineDataItem[]>(
    () =>
      data.map((d) => ({
        value: d.value,
        label: d.label.length > 8 ? d.label.slice(0, 7) + '…' : d.label,
      })),
    [data],
  );

  // Screen-reader summary — the polyline itself is not readable.
  const a11ySummary = useMemo(
    () =>
      `${title ?? 'Line chart'}. ${data
        .map((d) => `${d.label}: ${Math.round(d.value)}`)
        .join(', ')}`,
    [title, data],
  );

  if (data.length < 2) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={[t.typography.caption, { color: t.colors.textMuted, textAlign: 'center' }]}>
          {data.length === 0 ? 'No data' : 'Need at least 3 trips with dates'}
        </Text>
      </View>
    );
  }

  return (
    <View accessible accessibilityLabel={a11ySummary}>
      {title ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted, marginBottom: 4 }]}>
          {title}
        </Text>
      ) : null}
      <GiftedLineChart
        data={giftedData}
        width={plotW}
        height={plotH}
        adjustToWidth
        disableScroll
        initialSpacing={12}
        endSpacing={12}
        color={lineColor}
        thickness={2}
        dataPointsColor={lineColor}
        dataPointsRadius={4}
        noOfSections={4}
        yAxisLabelWidth={Y_AXIS_LABEL_WIDTH}
        formatYLabel={compactNumber}
        yAxisColor={t.colors.border}
        xAxisColor={t.colors.border}
        yAxisThickness={1}
        xAxisThickness={1}
        hideRules
        yAxisTextStyle={[t.typography.caption, { color: t.colors.textMuted }]}
        xAxisLabelTextStyle={[t.typography.caption, { color: t.colors.textMuted }]}
        isAnimated={!reducedMotion}
        animationDuration={600}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
  },
});
