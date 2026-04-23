import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/api';

export default function AppLayout() {
  const { data: session, isLoading } = useSession();
  if (isLoading) return null;
  if (!session) return <Redirect href="/login" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
