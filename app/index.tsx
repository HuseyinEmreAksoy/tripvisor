import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useSession } from '@/api';

export default function Root() {
  const { data: session, isLoading } = useSession();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) return <Redirect href="/login" />;
  return <Redirect href="/trips" />;
}
