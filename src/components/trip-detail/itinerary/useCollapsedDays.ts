/**
 * useCollapsedDays — per-device open/closed state of itinerary day sections
 * (v2 M4 X2.3).
 *
 * The user's explicit choices are remembered per trip on this device
 * (AsyncStorage; localStorage on web — UI preference only, never trip data,
 * never synced). Days the user hasn't touched follow the default rule
 * (`isCollapsedByDefault`): while the trip is live, past days start
 * collapsed so today is what you see first.
 *
 * Reads are async: until the stored overrides arrive, the default rule
 * applies (the common case needs no storage at all). Storage failures are
 * silent — collapse state is a convenience, not data.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isCollapsedByDefault } from './dayChips';

export const COLLAPSED_DAYS_KEY_PREFIX = '@tripvisor/itinerary-collapsed/v1/';

type Overrides = Readonly<Record<string, boolean>>;

function parseOverrides(raw: string | null): Overrides {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean' && /^-?\d+$/.test(k)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export interface CollapsedDays {
  isCollapsed: (dayIndex: number) => boolean;
  toggle: (dayIndex: number) => void;
  /** Force a section open (e.g. the user jumped to it from the day strip). */
  expand: (dayIndex: number) => void;
}

export function useCollapsedDays(tripId: string, todayIndex: number | null): CollapsedDays {
  const [overrides, setOverrides] = useState<Overrides>({});
  const key = `${COLLAPSED_DAYS_KEY_PREFIX}${tripId}`;
  // Tracks whether the user changed anything before the stored value
  // loaded, so a slow read never clobbers a fresh tap.
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    touched.current = false;
    setOverrides({});
    AsyncStorage.getItem(key)
      .then((raw) => {
        if (cancelled || touched.current) return;
        setOverrides(parseOverrides(raw));
      })
      .catch(() => {
        // Preference unavailable — defaults apply.
      });
    return () => {
      cancelled = true;
    };
  }, [key]);

  const write = useCallback(
    (update: (prev: Overrides) => Overrides) => {
      touched.current = true;
      setOverrides((prev) => {
        const next = update(prev);
        if (next !== prev) {
          AsyncStorage.setItem(key, JSON.stringify(next)).catch(() => {
            // Not persisted this time — the session state still holds.
          });
        }
        return next;
      });
    },
    [key],
  );

  const isCollapsed = useCallback(
    (dayIndex: number) => overrides[String(dayIndex)] ?? isCollapsedByDefault(dayIndex, todayIndex),
    [overrides, todayIndex],
  );

  const toggle = useCallback(
    (dayIndex: number) =>
      write((prev) => {
        const current = prev[String(dayIndex)] ?? isCollapsedByDefault(dayIndex, todayIndex);
        return { ...prev, [String(dayIndex)]: !current };
      }),
    [write, todayIndex],
  );

  const expand = useCallback(
    (dayIndex: number) =>
      write((prev) => {
        const current = prev[String(dayIndex)] ?? isCollapsedByDefault(dayIndex, todayIndex);
        return current ? { ...prev, [String(dayIndex)]: false } : prev;
      }),
    [write, todayIndex],
  );

  return { isCollapsed, toggle, expand };
}
