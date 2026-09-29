/**
 * useAiEditApply (M5 F10 #2, #7): an AI add whose day move never lands is
 * reported ("added to Ideas") instead of silently succeeding, and clearUndo()
 * really ends the undo window.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import type { TripPlace } from '@/api';

const mockCreatePlace = jest.fn(async (_input: unknown) => ({ id: 'new-1' }));
const mockDeletePlace = jest.fn(async (_input: unknown) => undefined);
const mockMoveToDay = jest.fn(async (_input: unknown) => undefined);
const mockUpdatePlace = jest.fn(async (_input: unknown) => undefined);
const mockOptimize = jest.fn(async (_input: unknown) => undefined);

jest.mock('@/api', () => ({
  useCreateTripPlace: () => ({ mutateAsync: mockCreatePlace }),
  useDeleteTripPlace: () => ({ mutateAsync: mockDeletePlace }),
  useMoveToDay: () => ({ mutateAsync: mockMoveToDay }),
  useUpdateTripPlace: () => ({ mutateAsync: mockUpdatePlace }),
  useOptimizeTrip: () => ({ mutateAsync: mockOptimize }),
}));

const mockSchedule = jest.fn(async (..._args: unknown[]) => true);
jest.mock('../useAiScheduleOnDay', () => ({
  scheduleOnDayWithRetry: (...args: unknown[]) => mockSchedule(...args),
}));

// eslint-disable-next-line import/first
import { useAiEditApply } from '../useAiEditApply';

const addOp = {
  kind: 'add' as const,
  place: {
    name: 'Sainte-Chapelle',
    googlePlaceId: 'g9',
    lat: 48.85,
    lng: 2.34,
    visitMinutes: 60,
    category: 'church',
    dayHint: 2,
  },
};

function applyArgs() {
  return {
    tripId: 't1',
    places: [] as TripPlace[],
    ops: [addOp],
    routeRenderMode: 'manual' as const,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSchedule.mockResolvedValue(true);
});

describe('useAiEditApply', () => {
  it('schedules an add on its 0-based day via the retrying helper', async () => {
    const { result } = renderHook(() => useAiEditApply());
    let outcome;
    await act(async () => {
      outcome = await result.current.apply(applyArgs());
    });
    expect(mockSchedule).toHaveBeenCalledWith(mockMoveToDay, { id: 'new-1', tripId: 't1', toDayIndex: 1 });
    expect(outcome).toEqual({ applied: 1, failures: [], canUndo: true });
  });

  it('reports an add that landed in Ideas, still counting it as applied', async () => {
    mockSchedule.mockResolvedValue(false);
    const { result } = renderHook(() => useAiEditApply());
    let outcome: Awaited<ReturnType<typeof result.current.apply>> = null;
    await act(async () => {
      outcome = await result.current.apply(applyArgs());
    });
    expect(outcome!.applied).toBe(1);
    expect(outcome!.failures).toHaveLength(1);
    expect(outcome!.failures[0]!.message).toMatch(/Ideas/);
  });

  it('clearUndo() ends the undo window', async () => {
    const { result } = renderHook(() => useAiEditApply());
    await act(async () => {
      await result.current.apply(applyArgs());
    });
    act(() => result.current.clearUndo());
    let undone;
    await act(async () => {
      undone = await result.current.undo();
    });
    expect(undone).toBeNull();
    expect(mockDeletePlace).not.toHaveBeenCalled();
  });
});
