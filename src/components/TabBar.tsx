/**
 * TabBar — Redesigned with pill-shaped active indicator, gradient underline, smooth transitions.
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
          borderColor: t.colors.border,
          backgroundColor: t.colors.bg,
          paddingHorizontal: t.spacing.sm,
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
                paddingVertical: t.spacing.md,
                borderRadius: t.radius.sm,
              },
              pressed && !active && { backgroundColor: t.colors.gradientSubtle },
              Platform.OS === 'web' && ({
                transition: 'all 0.2s ease',
                cursor: 'pointer',
              } as ViewStyle),
            ]}
          >
            {/* Active indicator bar */}
            <View
              style={[
                styles.indicator,
                {
                  backgroundColor: active ? t.colors.primary : 'transparent',
                  borderRadius: t.radius.pill,
                  height: 3,
                },
                Platform.OS === 'web' && ({
                  transition: 'background-color 0.2s ease',
                } as ViewStyle),
              ]}
            />
            <Text
              style={[
                active ? t.typography.bodyStrong : t.typography.body,
                {
                  color: active ? t.colors.primary : t.colors.textMuted,
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
    borderBottomWidth: 1,
    gap: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
  },
  indicator: {
    alignSelf: 'stretch',
    marginHorizontal: 8,
  },
});
