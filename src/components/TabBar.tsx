/**
 * TabBar — v2 "Tide & Terracotta" primitive.
 *
 * Pill-chip tabs on a quiet bar: the active tab is a teal-tinted pill with
 * bold primary text; inactive tabs are muted. No divider — whitespace and
 * the pill do the work. Roles: tablist / tab with selected state — unchanged.
 */
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

interface TabBarProps<T extends string> {
  tabs: Array<{ key: T; label: string }>;
  activeKey: T;
  onSelect: (key: T) => void;
}

export function TabBar<T extends string>({ tabs, activeKey, onSelect }: TabBarProps<T>) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: t.colors.bg,
          paddingHorizontal: t.spacing.sm,
          paddingVertical: t.spacing.sm,
        },
      ]}
      accessibilityRole="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            onPress={() => onSelect(tab.key)}
            style={({ pressed }) => [
              styles.tab,
              {
                borderRadius: t.radius.pill,
                backgroundColor: active ? t.colors.gradientSubtle : 'transparent',
              },
              pressed && !active && { backgroundColor: t.colors.bgMuted },
              Platform.OS === 'web' && ({
                transition: 'all 0.2s ease',
                cursor: 'pointer',
              } as ViewStyle),
            ]}
          >
            <Text
              style={[
                active ? t.typography.bodyStrong : t.typography.body,
                {
                  color: active ? t.colors.primary : t.colors.textMuted,
                  fontSize: 15,
                  fontWeight: active ? '700' : '500',
                  textAlign: 'center',
                },
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
});
