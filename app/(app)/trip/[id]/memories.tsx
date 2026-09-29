/**
 * /trip/[id]/memories — the trip's memories timeline (M5 Y3.1).
 * Optional params: `day` (0-based) + `compose=journal` (from Today).
 * The screen lives in src/components/memories/MemoriesScreen.tsx.
 */
import { MemoriesScreen } from '@/components/memories/MemoriesScreen';

export default function TripMemoriesRoute() {
  return <MemoriesScreen />;
}
