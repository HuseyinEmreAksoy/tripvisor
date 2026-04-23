import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/api';

export default function AuthLayout() {
  const { data: session, isLoading } = useSession();
  if (isLoading) return null;
  if (session) return <Redirect href="/trips" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
