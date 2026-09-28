/**
 * useDayCheckoffs — this device's Done / Skip marks for one trip day
 * (v2 M4 X2.1).
 *
 * Check-offs are a personal, per-device progress aid — NOT trip data: no
 * migration, no server write, no sync. They live in AsyncStorage (which is
 * localStorage on web) under one key per trip + day, so a restart keeps them
 * and a new day starts clean.
 *
 * Read failures degrade to "nothing checked"; write failures keep the
 * in-memory state (the marks still work for this session).
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CheckoffStatus } from './todayPlan';

export type CheckoffMap = Readonly<Record<string, CheckoffStatus>>;

const KEY_PREFIX = '@tripvisor/today-checkoffs/v1';

export function checkoffStorageKey(tripId: string, dayIndex: number): string {
  return `${KEY_PREFIX}/${tripId}/${dayIndex}`;
}

function parseCheckoffs(raw: string | null): CheckoffMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, CheckoffStatus> = {};
    for (const [placeId, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (value === 'done' || value === 'skipped') out[placeId] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export interface UseDayCheckoffsResult {
  checkoffs: CheckoffMap;
  /** True until the stored marks have been read once. */
  loading: boolean;
  /** Set (or clear, with null) one stop's mark. */
  setCheckoff: (placeId: string, status: CheckoffStatus | null) => void;
}

export function useDayCheckoffs(tripId: string | undefined, dayIndex: number | null): UseDayCheckoffsResult {
  const key = tripId && dayIndex !== null ? checkoffStorageKey(tripId, dayIndex) : null;
  const [state, setState] = useState<{ key: string | null; map: CheckoffMap; loaded: boolean }>({
    key: null,
    map: {},
    loaded: false,
  });

  useEffect(() => {
    let cancelled = false;
    if (!key) {
      setState({ key: null, map: {}, loaded: true });
      return;
    }
    setState({ key, map: {}, loaded: false });
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (!cancelled) setState({ key, map: parseCheckoffs(raw), loaded: true });
      })
      .catch(() => {
        if (!cancelled) setState({ key, map: {}, loaded: true });
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const setCheckoff = useCallback(
    (placeId: string, status: CheckoffStatus | null) => {
      if (!key) return;
      setState((prev) => {
        if (prev.key !== key) return prev;
        const next: Record<string, CheckoffStatus> = { ...prev.map };
        if (status) next[placeId] = status;
        else delete next[placeId];
        AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {
          // Storage full / unavailable — keep the in-memory marks.
        });
        return { key, map: next, loaded: true };
      });
    },
    [key],
  );

  const current = state.key === key ? state : { map: {}, loaded: false };
  return { checkoffs: current.map, loading: !current.loaded, setCheckoff };
}
