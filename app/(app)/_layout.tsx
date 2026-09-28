import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/api';
import { UndoToast } from '@/components/UndoToast';

// v2 M4 X1.1: the (tabs) group (Trips · Today · Insights · Profile) is the
// base of this Stack, so a deep link straight to /trip/:id still has the tabs
// underneath and "back" lands on Trips instead of a dead end.
export const unstable_settings = {
  initialRouteName: '(tabs)',
};

export default function AppLayout() {
  const { data: session, isLoading } = useSession();
  if (isLoading) return null;
  if (!session) return <Redirect href="/login" />;

  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      {/* v2 S2.8.8: global undo toast — absolute-positioned sibling of the
          Stack so it floats over every signed-in screen. Renders null while
          the Tier-1 sync flag is off (undo entries are only pushed by sync
          mutations), so the v1 tree is unchanged. */}
      <UndoToast />
    </>
  );
}
