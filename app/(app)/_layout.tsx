import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/api';
import { UndoToast } from '@/components/UndoToast';

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
