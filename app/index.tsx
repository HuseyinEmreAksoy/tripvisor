import { Redirect, type Href } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useSession } from '@/api';
import { usePendingRedirect } from '@/hooks/usePendingRedirect';

export default function Root() {
  const { data: session, isLoading } = useSession();
  // Magic links land on `/`; consume any stored post-login destination here.
  const pending = usePendingRedirect(!!session);

  if (isLoading || (session && !pending.ready)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator accessibilityLabel="Loading" />
      </View>
    );
  }

  if (!session) return <Redirect href="/login" />;
  return <Redirect href={(pending.path ?? '/trips') as Href} />;
}
