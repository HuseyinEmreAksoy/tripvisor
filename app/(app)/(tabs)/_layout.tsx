/**
 * Signed-in tab shell (v2 M4 X1.1): Trips · Today · Insights · Profile.
 *
 * Nested INSIDE `app/(app)/_layout.tsx`, so the auth guard there still wraps
 * every tab. `(tabs)` is a route group, so URLs are unchanged: `/trips`,
 * `/today`, `/analytics`, `/settings`. Deep screens (trip detail, add place,
 * print, place detail…) remain Stack screens in `(app)` pushed over this
 * group, so the tab bar is hidden there.
 *
 * Bottom bar under 1024 px, left rail at 1024 px+ (see AppTabBar).
 *
 * Android hardware back: `backBehavior="firstRoute"` — back on Today /
 * Insights / Profile returns to Trips; back on Trips leaves the app (there
 * is nothing underneath: the auth screens `replace` into the app).
 */
import { Tabs } from 'expo-router';
import { AppTabBar } from '@/components/navigation/AppTabBar';
import { useBreakpoint } from '@/hooks/useBreakpoint';

export default function TabsLayout() {
  const isDesktop = useBreakpoint() === 'desktop';

  return (
    <Tabs
      backBehavior="firstRoute"
      tabBar={(props) => <AppTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        tabBarPosition: isDesktop ? 'left' : 'bottom',
        // Screens stay mounted across switches (keeps list scroll + search).
        lazy: true,
      }}
    >
      <Tabs.Screen name="trips" options={{ title: 'Trips', tabBarAccessibilityLabel: 'Trips' }} />
      <Tabs.Screen name="today" options={{ title: 'Today', tabBarAccessibilityLabel: 'Today' }} />
      <Tabs.Screen
        name="analytics"
        options={{ title: 'Insights', tabBarAccessibilityLabel: 'Insights' }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Profile', tabBarAccessibilityLabel: 'Profile and settings' }}
      />
    </Tabs>
  );
}
