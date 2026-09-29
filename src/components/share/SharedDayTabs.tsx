/**
 * SharedDayTabs — horizontally scrolling day tabs for the public share page:
 * "Overview" + one pill per day (with its date when the trip has one).
 * Each pill carries its day color so tabs, map pins and timeline dots match.
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { dayColor, useTheme } from '@/theme';
import { useT } from '@/i18n';
import type { DayKey, DayTab } from './sharedTripModel';

interface Props {
  tabs: DayTab[];
  selected: DayKey;
  onSelect: (key: DayKey) => void;
}

export function SharedDayTabs({ tabs, selected, onSelect }: Props) {
  const t = useTheme();
  const { t: tx } = useT('share');
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: t.spacing.sm, paddingHorizontal: t.spacing.lg, paddingVertical: t.spacing.xs }}
      accessibilityRole="tablist"
      accessibilityLabel={tx('timeline.tabsA11y')}
    >
      {tabs.map((tab) => {
        const isSelected = tab.key === selected;
        const swatch = tab.key === 'all' ? null : dayColor(tab.key);
        return (
          <Pressable
            key={String(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={tab.sublabel ? `${tab.label}, ${tab.sublabel}` : tab.label}
            onPress={() => onSelect(tab.key)}
            style={({ pressed }) => [
              styles.tab,
              {
                borderRadius: t.radius.pill,
                paddingHorizontal: t.spacing.md,
                gap: t.spacing.sm,
                borderColor: isSelected ? t.colors.text : t.colors.border,
                backgroundColor: isSelected ? t.colors.text : pressed ? t.colors.bgMuted : t.colors.cardBgSolid,
              },
            ]}
          >
            {swatch ? <View style={[styles.swatch, { backgroundColor: swatch }]} /> : null}
            <View>
              <Text style={[t.typography.caption, { color: isSelected ? t.colors.bg : t.colors.text, fontWeight: '700' }]}>
                {tab.label}
              </Text>
              {tab.sublabel ? (
                <Text style={[t.typography.small, { color: isSelected ? t.colors.bg : t.colors.textMuted }]}>
                  {tab.sublabel}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tab: { borderWidth: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center' },
  swatch: { width: 10, height: 10, borderRadius: 5 },
});
