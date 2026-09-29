/**
 * scheduleOnDayWithRetry — create-then-move helper for the AI surfaces
 * (AI edit apply/undo, gap-fill "Add").
 *
 * With Tier-1 sync on (EXPO_PUBLIC_SYNC_TIER1=1) `useCreateTripPlace` returns
 * an optimistic local row and only QUEUES the server INSERT, while
 * `useMoveToDay` is a direct PostgREST update. A move that runs before the
 * queued INSERT lands finds 0 rows and throws. A couple of short retries cover
 * that window — the same delays trip/[id]/add.tsx uses. Offline, every attempt
 * fails and the caller reports "landed in Ideas" instead of claiming success.
 *
 * Lives under src/hooks/useAi* so the AI fixers own it; add.tsx keeps its own
 * copy for now (outside this bucket) and can switch to this later.
 */
import type { Uuid } from '@/api';

export const AI_MOVE_RETRY_DELAYS_MS: readonly number[] = [0, 800, 2000];

export interface ScheduleOnDayArgs {
  id: Uuid;
  tripId: Uuid;
  toDayIndex: number;
  positionInDay?: number;
}

export type MoveToDayFn = (args: ScheduleOnDayArgs) => Promise<unknown>;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Tries the move once per delay. Resolves `true` when it landed, `false` when
 * every attempt failed (the place stays in Ideas). Never throws.
 */
export async function scheduleOnDayWithRetry(
  move: MoveToDayFn,
  args: ScheduleOnDayArgs,
  delays: readonly number[] = AI_MOVE_RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = wait,
): Promise<boolean> {
  for (const delay of delays) {
    if (delay) await sleep(delay);
    try {
      await move(args);
      return true;
    } catch {
      // retry; the caller reports the final failure honestly
    }
  }
  return false;
}
