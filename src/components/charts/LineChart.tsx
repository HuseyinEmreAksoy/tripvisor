/**
 * LineChart — hand-rolled SVG line chart using react-native-svg.
 *
 * Chart library: react-native-svg (same rationale as BarChart.tsx —
 * victory-native is incompatible with React 18).
 *
 * Phase 24 Step 24.11 / 24.12.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { useTheme } from '@/theme';

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

const PADDING = { top: 16, right: 12, bottom: 40, left: 48 };
const DEFAULT_HEIGHT = 180;

export function LineChart({
  data,
  width,
  height = DEFAULT_HEIGHT,
  color,
  title,
}: LineChartProps) {
  const t = useTheme();
  const lineColor = color ?? t.colors.primary;

  const chartW = width - PADDING.left - PADDING.right;
  const chartH = height - PADDING.top - PADDING.bottom;

  const maxVal = useMemo(() => Math.max(...data.map((d) => d.value), 1), [data]);

  const points = useMemo(
    () =>
      data.map((d, i) => ({
        ...d,
        x: PADDING.left + (i / Math.max(data.length - 1, 1)) * chartW,
        y: PADDING.top + chartH - (d.value / maxVal) * chartH,
      })),
    [data, chartW, chartH, maxVal],
  );

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');

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
    <View>
      {title ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted, marginBottom: 4 }]}>
          {title}
        </Text>
      ) : null}
      <Svg width={width} height={height}>
        {/* Y axis */}
        <Line
          x1={PADDING.left}
          y1={PADDING.top}
          x2={PADDING.left}
          y2={PADDING.top + chartH}
          stroke={t.colors.border}
          strokeWidth={1}
        />
        {/* X axis */}
        <Line
          x1={PADDING.left}
          y1={PADDING.top + chartH}
          x2={PADDING.left + chartW}
          y2={PADDING.top + chartH}
          stroke={t.colors.border}
          strokeWidth={1}
        />

        {/* Line */}
        <Polyline
          points={polylinePoints}
          fill="none"
          stroke={lineColor}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Data points + labels */}
        {points.map((p, i) => (
          <React.Fragment key={`pt-${i}`}>
            <Circle cx={p.x} cy={p.y} r={4} fill={lineColor} />
            <SvgText
              x={p.x}
              y={PADDING.top + chartH + 14}
              fontSize={9}
              fill={t.colors.textMuted}
              textAnchor="middle"
            >
              {p.label.length > 8 ? p.label.slice(0, 7) + '…' : p.label}
            </SvgText>
          </React.Fragment>
        ))}

        {/* Y axis max label */}
        <SvgText
          x={PADDING.left - 4}
          y={PADDING.top + 4}
          fontSize={9}
          fill={t.colors.textMuted}
          textAnchor="end"
        >
          {maxVal > 999 ? `${(maxVal / 1000).toFixed(1)}k` : String(Math.round(maxVal))}
        </SvgText>
      </Svg>
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
