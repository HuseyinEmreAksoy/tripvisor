/**
 * AppTabBar — the signed-in app's primary navigation (v2 M4 X1.1).
 *
 * Passed as the custom `tabBar` of `app/(app)/(tabs)/_layout.tsx`:
 *   - < 1024 px (phones, tablets): a safe-area-aware BOTTOM bar — Lucide
 *     icon over a short label, ≥ 56 pt tall, lifted above the Android
 *     gesture/nav bar via the navigator's `insets.bottom` (SDK 54 is
 *     edge-to-edge, so the bar would otherwise sit under it).
 *   - ≥ 1024 px (desktop web): a LEFT RAIL with the brand mark on top, so
 *     desktop isn't a stretched phone. The layout sets
 *     `tabBarPosition: 'left'` to match.
 *
 * Deep screens (trip detail, add place, print…) are Stack screens pushed
 * OVER the tabs group, so this bar never renders on them.
 *
 * Press handling mirrors React Navigation's default bar: emit `tabPress`
 * (so screens can intercept / scroll-to-top later), then navigate unless
 * prevented or already focused. A light haptic confirms the switch (native
 * only, reduced-motion aware — see src/lib/haptics.ts).
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useTheme } from '@/theme';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { haptics } from '@/lib/haptics';
import { Icon, type IconName } from '../Icon';

/** Width of the desktop left rail — screens subtract it for width math. */
export const TAB_RAIL_WIDTH = 96;

/** Route name (file name inside the (tabs) group) → icon. */
const TAB_ICONS: Record<string, IconName> = {
  trips: 'map',
  today: 'sun',
  analytics: 'chart-column',
  settings: 'circle-user',
};

export function AppTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const t = useTheme();
  const isRail = useBreakpoint() === 'desktop';

  const items = state.routes.map((route, index) => {
    const { options } = descriptors[route.key]!;
    const label = options.title ?? route.name;
    const focused = state.index === index;
    const color = focused ? t.colors.primary : t.colors.textMuted;

    const onPress = () => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (!focused && !event.defaultPrevented) {
        haptics.tap();
        navigation.navigate(route.name, route.params);
      }
    };
    const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });

    return (
      <Pressable
        key={route.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: focused }}
        accessibilityLabel={options.tabBarAccessibilityLabel ?? label}
        testID={`tab-${route.name}`}
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [
          isRail ? styles.railItem : styles.barItem,
          {
            borderRadius: t.radius.lg,
            backgroundColor: focused && isRail ? t.colors.gradientSubtle : 'transparent',
            opacity: pressed ? 0.7 : 1,
          },
        ]}
      >
        <View
          style={[
            styles.iconPill,
            {
              borderRadius: t.radius.pill,
              backgroundColor: focused && !isRail ? t.colors.gradientSubtle : 'transparent',
            },
          ]}
        >
          <Icon name={TAB_ICONS[route.name] ?? 'map'} size={22} color={color} strokeWidth={focused ? 2.25 : 1.75} />
        </View>
        <Text
          numberOfLines={1}
          style={[
            t.typography.small,
            { color, fontWeight: focused ? '800' : '600', marginTop: 2 },
          ]}
        >
          {label}
        </Text>
      </Pressable>
    );
  });

  if (isRail) {
    return (
      <View
        accessibilityRole="tablist"
        style={[
          styles.rail,
          {
            width: TAB_RAIL_WIDTH,
            paddingTop: insets.top + t.spacing.xl,
            paddingBottom: insets.bottom + t.spacing.lg,
            backgroundColor: t.colors.bgElevated,
            borderRightColor: t.colors.border,
            gap: t.spacing.sm,
          },
        ]}
      >
        <View
          style={[styles.brand, { marginBottom: t.spacing.lg }]}
          accessible
          accessibilityLabel="Tripvisor"
        >
          <View
            style={[
              styles.brandMark,
              { backgroundColor: t.colors.primary, borderRadius: t.radius.md },
            ]}
          >
            <Icon name="compass" size={24} color={t.colors.primaryText} strokeWidth={2} />
          </View>
        </View>
        {items}
      </View>
    );
  }

  return (
    <View
      accessibilityRole="tablist"
      style={[
        styles.bar,
        {
          paddingBottom: Math.max(insets.bottom, t.spacing.sm),
          paddingLeft: insets.left,
          paddingRight: insets.right,
          backgroundColor: t.colors.bgElevated,
          borderTopColor: t.colors.border,
          ...t.shadows.sm(t.colors.shadowColor),
        },
      ]}
    >
      {items}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 6,
  },
  barItem: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rail: {
    height: '100%',
    alignItems: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  railItem: {
    width: 76,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  iconPill: {
    width: 56,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: {
    alignItems: 'center',
  },
  brandMark: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
