/**
 * BarChart — thin wrapper around react-native-gifted-charts' BarChart.
 *
 * v2 Phase P3.1: replaces the hand-rolled react-native-svg implementation
 * (the v1 workaround for victory-native's React-19 requirement — moot since
 * S1 upgraded us to React 19). gifted-charts renders through react-native-svg
 * + plain RN Views, so it works on iOS / Android / Web (RNW) from one file.
 * Gradients are NOT used: gifted's gradient module optionally resolves
 * expo-linear-gradient (already a dep) and we never enable `showGradient`.
 *
 * The exported prop contract is byte-compatible with the v1 component:
 *   - data: Array<{ label: string; value: number; color?: string }>
 *   - width / height: TOTAL footprint (caller measures via useWindowDimensions)
 *   - yAxisLabel?: suffix for Y axis tick labels (e.g. '€')
 *   - maxBars?: cap the number of bars shown (default 20)
 *   - title?: caption above the chart
 *   - grouped?: NEW (optional, additive) — adjacent bars pair up visually
 *     (small intra-pair gap, larger inter-pair gap). Used by the analytics
 *     liked/disliked chart, which flattens two series into alternating bars.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BarChart as GiftedBarChart, type barDataItem } from 'react-native-gifted-charts';
import { useTheme } from '@/theme';
import { useReducedMotion } from '@/hooks/useReducedMotion';

export interface BarChartDatum {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  data: BarChartDatum[];
  width: number;
  height?: number;
  yAxisLabel?: string;
  maxBars?: number;
  title?: string;
  grouped?: boolean;
}

// gifted renders the Y-axis label gutter OUTSIDE its `width` prop and the
// X-axis labels BELOW its `height` prop — budget both so the total footprint
// stays within the caller's width/height (cards clip on mobile otherwise).
const Y_AXIS_LABEL_WIDTH = 44;
const X_LABEL_SPACE = 64; // top headroom + x-axis label rows (old PADDING budget)
const DEFAULT_HEIGHT = 200;

function compactNumber(label: string): string {
  const n = Number(label);
  if (!Number.isFinite(n)) return label;
  return n > 999 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));
}

export function BarChart({
  data,
  width,
  height = DEFAULT_HEIGHT,
  yAxisLabel = '',
  maxBars = 20,
  title,
  grouped = false,
}: BarChartProps) {
  const t = useTheme();
  const reducedMotion = useReducedMotion();

  const sliced = useMemo(() => data.slice(0, maxBars), [data, maxBars]);

  const plotW = Math.max(80, width - Y_AXIS_LABEL_WIDTH);
  const plotH = Math.max(60, height - X_LABEL_SPACE);

  // Distribute bars to fill the plot width (no horizontal scrolling).
  const n = sliced.length;
  const slot = n > 0 ? plotW / n : 24;
  const barWidth = Math.max(8, Math.floor(slot) - 6);
  const gap = Math.max(2, slot - barWidth);
  // Grouped mode: alternate a tight intra-pair gap with a wide inter-pair gap
  // so flattened two-series data (👍/👎 per trip) reads as pairs.
  const intraGap = Math.max(2, Math.min(4, gap / 2));
  const interGap = Math.max(2, gap * 2 - intraGap);

  const giftedData = useMemo<barDataItem[]>(
    () =>
      sliced.map((d, i) => ({
        value: d.value,
        label: d.label.length > 10 ? d.label.slice(0, 9) + '…' : d.label,
        frontColor: d.color ?? t.colors.primary,
        ...(grouped ? { spacing: i % 2 === 0 ? intraGap : interGap } : {}),
      })),
    [sliced, t.colors.primary, grouped, intraGap, interGap],
  );

  // Screen-reader summary — the SVG bars themselves are not readable.
  const a11ySummary = useMemo(
    () =>
      `${title ?? 'Bar chart'}. ${sliced
        .map((d) => `${d.label}: ${Math.round(d.value)}${yAxisLabel}`)
        .join(', ')}`,
    [title, sliced, yAxisLabel],
  );

  if (sliced.length === 0) {
    return (
      <View style={[styles.empty, { width, height }]}>
        <Text style={[t.typography.caption, { color: t.colors.textMuted, textAlign: 'center' }]}>
          No data
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
      <GiftedBarChart
        data={giftedData}
        width={plotW}
        height={plotH}
        disableScroll
        barWidth={barWidth}
        spacing={gap}
        initialSpacing={Math.ceil(gap / 2)}
        endSpacing={Math.ceil(gap / 2)}
        barBorderTopLeftRadius={3}
        barBorderTopRightRadius={3}
        noOfSections={4}
        yAxisLabelWidth={Y_AXIS_LABEL_WIDTH}
        yAxisLabelSuffix={yAxisLabel}
        formatYLabel={compactNumber}
        yAxisColor={t.colors.border}
        xAxisColor={t.colors.border}
        yAxisThickness={1}
        xAxisThickness={1}
        rulesColor={t.colors.border}
        rulesType="dashed"
        dashWidth={4}
        dashGap={3}
        yAxisTextStyle={[t.typography.caption, { color: t.colors.textMuted }]}
        xAxisLabelTextStyle={[t.typography.caption, { color: t.colors.textMuted }]}
        xAxisTextNumberOfLines={1}
        disablePress
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
  },
});
