/** scheduleOnDayWithRetry — Tier-1 create→move race retry (M5 F10 #7). */
import { describe, expect, it, jest } from '@jest/globals';
import { scheduleOnDayWithRetry, type MoveToDayFn } from '../useAiScheduleOnDay';

const args = { id: 'p1', tripId: 't1', toDayIndex: 2 };
const noSleep = () => Promise.resolve();

describe('scheduleOnDayWithRetry', () => {
  it('succeeds on a later attempt once the queued INSERT has landed', async () => {
    const move = jest
      .fn<MoveToDayFn>()
      .mockRejectedValueOnce(new Error('0 rows'))
      .mockResolvedValueOnce(undefined);
    await expect(scheduleOnDayWithRetry(move, args, [0, 800, 2000], noSleep)).resolves.toBe(true);
    expect(move).toHaveBeenCalledTimes(2);
    expect(move).toHaveBeenCalledWith(args);
  });

  it('returns false (never throws) when every attempt fails, e.g. offline', async () => {
    const move = jest.fn<MoveToDayFn>().mockRejectedValue(new Error('offline'));
    const sleep = jest.fn((_ms: number) => Promise.resolve());
    await expect(scheduleOnDayWithRetry(move, args, [0, 800, 2000], sleep)).resolves.toBe(false);
    expect(move).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([800, 2000]);
  });
});
