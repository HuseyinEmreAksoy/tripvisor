/**
 * /trip/[id]/discover — interest-based recommendations (M5 Y3.4).
 * Optional `?day=N` (0-based) starts the search around that day's stops.
 * The screen lives in src/components/discover/DiscoverScreen.tsx.
 */
import { useLocalSearchParams } from 'expo-router';
import { DiscoverScreen } from '@/components/discover';

export default function DiscoverRoute() {
  const { id, day } = useLocalSearchParams<{ id: string; day?: string }>();
  return <DiscoverScreen tripId={id} dayParam={day} />;
}
