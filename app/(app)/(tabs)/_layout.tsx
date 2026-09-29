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
import { useT } from '@/i18n';

export default function TabsLayout() {
  const isDesktop = useBreakpoint() === 'desktop';
  // Re-renders on a language switch, so the labels follow Profile → Language.
  const { t: tx } = useT('shell');

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
      <Tabs.Screen name="trips" options={{ title: tx('tabs.trips'), tabBarAccessibilityLabel: tx('tabs.trips') }} />
      <Tabs.Screen name="today" options={{ title: tx('tabs.today'), tabBarAccessibilityLabel: tx('tabs.today') }} />
      <Tabs.Screen
        name="analytics"
        options={{ title: tx('tabs.insights'), tabBarAccessibilityLabel: tx('tabs.insights') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: tx('tabs.profile'), tabBarAccessibilityLabel: tx('tabs.profileA11y') }}
      />
    </Tabs>
  );
}
