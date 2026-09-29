/**
 * MapLegend — line-style chips for the leg modes drawn on the trip map
 * (M5 Y3.3): walk dotted, transit dashed, flight dashed arc, ferry dashed
 * blue, drive/bike solid. Lines keep their day colour on the map, so the
 * samples here are neutral (ferry keeps its blue). Shown only when the map
 * mixes styles — a drive-only trip needs no legend.
 */
import { StyleSheet, Text, View } from 'react-native';
import { surfaceStyle, useTheme } from '@/theme';
import { useT } from '@/i18n';
import { Icon } from '@/components/Icon';
import { legStroke, type LegStroke } from '@/components/Map/legGeometry';
import type { LegTransportMode } from '@/api/types';
import { LEG_MODES, LEG_MODE_ICON } from './legModes';

/** Distinct leg modes in display order; [] when a legend would add nothing. */
export function legendModesFor(
  legs: ReadonlyArray<{ transport_mode: string; polyline: string | null }>,
): LegTransportMode[] {
  const seen = new Set<string>();
  for (const l of legs) seen.add(l.transport_mode);
  const modes = LEG_MODES.filter((m) => seen.has(m));
  const allSolid = modes.every((m) => m === 'driving' || m === 'bicycling');
  return modes.length === 0 || (allSolid && modes.length < 2) ? [] : modes;
}

export function MapLegend({ modes }: { modes: readonly LegTransportMode[] }) {
  const t = useTheme();
  const { t: tx } = useT('routes');
  if (modes.length === 0) return null;
  const styleKey = (s: LegStroke) =>
    s === 'dotted' ? 'legend.dotted' : s === 'arc' ? 'legend.arc' : s === 'dashed' ? 'legend.dashed' : 'legend.solid';
  return (
    <View
      style={[styles.wrap, surfaceStyle(t, 'raised'), { borderRadius: t.radius.md, gap: t.spacing.sm }]}
      accessibilityLabel={tx('legend.label')}
      accessibilityRole="summary"
    >
      {modes.map((m) => {
        const stroke = legStroke(m, m === 'driving' || m === 'bicycling');
        const color = m === 'ferry' ? t.colors.info : t.colors.textMuted;
        const label = tx(`mode.${m}`);
        return (
          <View
            key={m}
            style={styles.item}
            accessible
            accessibilityLabel={tx('legend.item', { mode: label, style: tx(styleKey(stroke)) })}
          >
            <Icon name={LEG_MODE_ICON[m]} size={12} color={t.colors.textMuted} />
            <View
              style={[
                styles.sample,
                {
                  borderColor: color,
                  borderStyle: stroke === 'dotted' ? 'dotted' : stroke === 'solid' ? 'solid' : 'dashed',
                },
              ]}
            />
            <Text style={[t.typography.small, { color: t.colors.text }]}>{label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 360,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sample: { width: 18, height: 0, borderTopWidth: 2 },
});
