import { Redirect, Stack, type Href } from 'expo-router';
import { useSession } from '@/api';
import { usePendingRedirect } from '@/hooks/usePendingRedirect';

export default function AuthLayout() {
  const { data: session, isLoading } = useSession();
  // Once signed in, honour a stored post-login destination (e.g. an invite
  // link opened while signed out) before falling back to the trips list.
  const pending = usePendingRedirect(!!session);
  if (isLoading) return null;
  if (session) {
    if (!pending.ready) return null;
    return <Redirect href={(pending.path ?? '/trips') as Href} />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
