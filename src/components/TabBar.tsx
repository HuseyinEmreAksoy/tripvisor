import { Pressable, StyleSheet, Text, View } from 'react-native';
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
        { borderColor: t.colors.border, backgroundColor: t.colors.bg },
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
            style={[
              styles.tab,
              {
                borderBottomColor: active ? t.colors.primary : 'transparent',
                paddingVertical: t.spacing.md,
              },
            ]}
          >
            <Text
              style={[
                t.typography.bodyStrong,
                { color: active ? t.colors.text : t.colors.textMuted },
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
  row: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: 'center', borderBottomWidth: 2 },
});
