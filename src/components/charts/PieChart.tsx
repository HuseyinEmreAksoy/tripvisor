/**
 * PieChart — hand-rolled SVG pie/donut chart using react-native-svg.
 *
 * Chart library: react-native-svg (same rationale as BarChart.tsx —
 * victory-native is incompatible with React 18).
 *
 * Phase 24 Step 24.11 / 24.12.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useTheme } from '@/theme';

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
  const r = size / 2;
  const innerR = r * 0.55; // donut hole

  const total = useMemo(() => data.reduce((s, d) => s + d.value, 0), [data]);

  const slices = useMemo(() => {
    if (total === 0) return [];
    let angle = -Math.PI / 2; // start from top
    return data
      .filter((d) => d.value > 0)
      .map((d) => {
        const sweep = (d.value / total) * Math.PI * 2;
        const start = angle;
        const end = angle + sweep;
        angle = end;
        return { ...d, start, end, sweep };
      });
  }, [data, total]);

  function describeArc(
    cx: number,
    cy: number,
    radius: number,
    startAngle: number,
    endAngle: number,
  ): string {
    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);
    const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;

    const ix1 = cx + innerR * Math.cos(endAngle);
    const iy1 = cy + innerR * Math.sin(endAngle);
    const ix2 = cx + innerR * Math.cos(startAngle);
    const iy2 = cy + innerR * Math.sin(startAngle);

    return [
      `M ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
      `L ${ix1} ${iy1}`,
      `A ${innerR} ${innerR} 0 ${largeArcFlag} 0 ${ix2} ${iy2}`,
      'Z',
    ].join(' ');
  }

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
    <View style={styles.container}>
      {title ? (
        <Text style={[t.typography.caption, { color: t.colors.textMuted, marginBottom: 4 }]}>
          {title}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Background circle */}
          <Circle cx={r} cy={r} r={r - 1} fill={t.colors.bgMuted} />
          {slices.map((s, i) => (
            <Path
              key={`slice-${i}`}
              d={describeArc(r, r, r - 2, s.start, s.end)}
              fill={s.color}
              opacity={0.9}
            />
          ))}
          {/* Center hole fill */}
          <Circle cx={r} cy={r} r={innerR - 1} fill={t.colors.bgElevated} />
        </Svg>

        {/* Legend */}
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
