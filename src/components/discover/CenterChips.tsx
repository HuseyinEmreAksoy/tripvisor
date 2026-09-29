/**
 * CenterChips — "Search around": Whole trip · Day 1…N · My location
 * (M5 Y3.4). A single-select radio row that scrolls sideways on phones.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/theme';
import { useT } from '@/i18n';
import { Icon, type IconName } from '@/components/Icon';
import { haptics } from '@/lib/haptics';
import { centerModeKey, type CenterMode } from './discoverModel';

export interface CenterChipsProps {
  value: CenterMode;
  dayCount: number;
  onChange: (next: CenterMode) => void;
  locating?: boolean;
}

export function CenterChips({ value, dayCount, onChange, locating }: CenterChipsProps) {
  const t = useTheme();
  const { t: tx } = useT(['discover']);
  const options: Array<{ mode: CenterMode; label: string; icon: IconName }> = [
    { mode: { kind: 'trip' }, label: tx('center.trip'), icon: 'map' },
    ...Array.from({ length: dayCount }, (_, d) => ({
      mode: { kind: 'day', dayIndex: d } as CenterMode,
      label: tx('center.day', { n: d + 1 }),
      icon: 'calendar' as IconName,
    })),
    { mode: { kind: 'here' }, label: locating ? tx('center.locating') : tx('center.here'), icon: 'locate-fixed' },
  ];
  const activeKey = centerModeKey(value);
  return (
    <View style={{ gap: t.spacing.xs }}>
      <Text style={[t.typography.overline, { color: t.colors.textMuted }]} nativeID="discover-center-label">
        {tx('center.label')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: t.spacing.sm }}
        accessibilityRole="radiogroup"
        accessibilityLabel={tx('center.label')}
      >
        {options.map((o) => {
          const key = centerModeKey(o.mode);
          const on = key === activeKey;
          const color = on ? t.colors.primaryText : t.colors.text;
          return (
            <Pressable
              key={key}
              testID={`center-${key}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, selected: on }}
              accessibilityLabel={o.label}
              onPress={() => {
                haptics.select();
                onChange(o.mode);
              }}
              style={({ pressed }) => [
                styles.chip,
                {
                  gap: t.spacing.xs,
                  paddingHorizontal: t.spacing.md,
                  borderRadius: t.radius.pill,
                  backgroundColor: on ? t.colors.primary : t.colors.bgMuted,
                },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Icon name={o.icon} size={16} color={color} />
              <Text style={[t.typography.caption, { color, fontWeight: on ? '700' : '500' }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
});
