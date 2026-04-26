/**
 * BarChart — hand-rolled SVG bar chart using react-native-svg.
 *
 * Chart library: react-native-svg (already in deps).
 * Reason: victory-native@41 requires @shopify/react-native-skia which
 * demands React 19; this project uses React 18, making victory-native
 * incompatible. Hand-rolled SVG is adequate for the 4 chart types needed.
 *
 * Props:
 *   - data: Array<{ label: string; value: number; color?: string }>
 *   - width / height: layout dimensions (caller measures via useWindowDimensions)
 *   - yAxisLabel?: suffix for Y axis tick labels (e.g. '€')
 *   - maxBars?: cap the number of bars shown (default 20)
 *
 * Phase 24 Step 24.11 / 24.12.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/theme';

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
}

const PADDING = { top: 16, right: 12, bottom: 48, left: 48 };
const DEFAULT_HEIGHT = 200;

export function BarChart({
  data,
  width,
  height = DEFAULT_HEIGHT,
  yAxisLabel = '',
  maxBars = 20,
  title,
}: BarChartProps) {
  const t = useTheme();

  const sliced = useMemo(() => data.slice(0, maxBars), [data, maxBars]);

  const chartW = width - PADDING.left - PADDING.right;
  const chartH = height - PADDING.top - PADDING.bottom;

  const maxVal = useMemo(
    () => Math.max(...sliced.map((d) => d.value), 1),
    [sliced],
  );

  const barWidth = sliced.length > 0 ? Math.max(8, chartW / sliced.length - 6) : 24;

  const yTicks = useMemo(() => {
    const steps = 4;
    const step = Math.ceil(maxVal / steps / 10) * 10 || 1;
    return Array.from({ length: steps + 1 }, (_, i) => i * step).filter(
      (v) => v <= maxVal * 1.05,
    );
  }, [maxVal]);

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
    <View>
      {title ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted, marginBottom: 4 }]}>
          {title}
        </Text>
      ) : null}
      <Svg width={width} height={height}>
        {/* Y axis grid lines */}
        {yTicks.map((tick) => {
          const y = PADDING.top + chartH - (tick / maxVal) * chartH;
          return (
            <React.Fragment key={`tick-${tick}`}>
              <Line
                x1={PADDING.left}
                y1={y}
                x2={PADDING.left + chartW}
                y2={y}
                stroke={t.colors.border}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
              <SvgText
                x={PADDING.left - 4}
                y={y + 4}
                fontSize={9}
                fill={t.colors.textMuted}
                textAnchor="end"
              >
                {tick > 999 ? `${(tick / 1000).toFixed(1)}k` : String(tick)}
                {yAxisLabel}
              </SvgText>
            </React.Fragment>
          );
        })}

        {/* Bars */}
        {sliced.map((d, i) => {
          const barH = Math.max(2, (d.value / maxVal) * chartH);
          const x = PADDING.left + i * (chartW / sliced.length) + (chartW / sliced.length - barWidth) / 2;
          const y = PADDING.top + chartH - barH;
          const color = d.color ?? t.colors.primary;

          return (
            <React.Fragment key={`bar-${i}`}>
              <Rect
                x={x}
                y={y}
                width={barWidth}
                height={barH}
                rx={3}
                fill={color}
                opacity={0.85}
              />
              {/* X axis label */}
              <SvgText
                x={x + barWidth / 2}
                y={PADDING.top + chartH + 14}
                fontSize={9}
                fill={t.colors.textMuted}
                textAnchor="middle"
                // Truncate long labels to 10 chars
              >
                {d.label.length > 10 ? d.label.slice(0, 9) + '…' : d.label}
              </SvgText>
            </React.Fragment>
          );
        })}

        {/* Y axis line */}
        <Line
          x1={PADDING.left}
          y1={PADDING.top}
          x2={PADDING.left}
          y2={PADDING.top + chartH}
          stroke={t.colors.border}
          strokeWidth={1}
        />
        {/* X axis line */}
        <Line
          x1={PADDING.left}
          y1={PADDING.top + chartH}
          x2={PADDING.left + chartW}
          y2={PADDING.top + chartH}
          stroke={t.colors.border}
          strokeWidth={1}
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
