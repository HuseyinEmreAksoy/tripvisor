/**
 * M5 Y2.2 — src/api/preferences.ts: user_preferences Tier-2 hooks and the
 * language mirror.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

type Op = [string, unknown[]];
const mockCalls: Array<{ table: string; ops: Op[] }> = [];
let mockRow: Record<string, unknown> | null = null;
let mockError: { message: string } | null = null;
let mockUserId: string | null = 'u1';

jest.mock('../supabase', () => {
  const makeChain = (table: string) => {
    const rec = { table, ops: [] as Op[] };
    mockCalls.push(rec);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'upsert', 'single', 'maybeSingle']) {
      chain[m] = (...args: unknown[]) => {
        rec.ops.push([m, args]);
        return chain;
      };
    }
    chain.then = (resolve: (v: unknown) => unknown) => {
      if (mockError) return resolve({ data: null, error: mockError });
      const upsert = rec.ops.find(([m]) => m === 'upsert');
      if (upsert) {
        const payload = upsert[1][0] as Record<string, unknown>;
        mockRow = {
          locale: null,
          home_currency: null,
          interests: [],
          ...(mockRow ?? {}),
          ...payload,
          updated_at: '2026-09-29T10:00:00Z',
        };
      }
      return resolve({ data: mockRow, error: null });
    };
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => makeChain(table),
      auth: {
        getSession: async () => ({ data: { session: mockUserId ? { user: { id: mockUserId } } : null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
    },
  };
});

jest.mock('@/sync/hydrate', () => ({
  initTier1Sync: jest.fn(async () => ({ started: false, degraded: false })),
  teardownTier1Sync: jest.fn(),
}));

// useSession's queryFn starts the per-user auth lifecycle (Tier-1 sync +
// photo upload pump) once it resolves a session. Keep the real upload queue
// (NetInfo, AsyncStorage, blob store) out of these preference tests.
jest.mock('../memories.upload-queue', () => ({
  startPhotoUploads: jest.fn(),
  stopPhotoUploads: jest.fn(),
}));

/* eslint-disable import/first */
import {
  _resetLanguageMirrorForTests,
  localeForLanguagePreference,
  toUserPreferences,
  useLanguagePreferenceMirror,
  useUpdateUserPreferences,
  useUserPreferences,
  userPreferencesKeys,
} from '../preferences';
import { getLanguagePreference, setLanguagePreference } from '@/i18n/preference';
/* eslint-enable import/first */

const clients: QueryClient[] = [];
function setup() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  clients.push(qc);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

function upserts() {
  return mockCalls
    .filter((c) => c.table === 'user_preferences')
    .map((c) => c.ops.find(([m]) => m === 'upsert'))
    .filter((op): op is Op => op !== undefined)
    .map((op) => ({ payload: op[1][0], options: op[1][1] }));
}

beforeEach(() => {
  mockCalls.length = 0;
  mockRow = null;
  mockError = null;
  mockUserId = 'u1';
  _resetLanguageMirrorForTests();
});

afterEach(async () => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  if (getLanguagePreference() !== 'system') await act(() => setLanguagePreference('system'));
});

describe('toUserPreferences', () => {
  it('defaults when there is no row', () => {
    expect(toUserPreferences(null)).toEqual({ locale: null, home_currency: null, interests: [], saved: false, updated_at: null });
  });

  it('maps a row, keeping well-formed interests once and reading unknown locales as System', () => {
    expect(
      toUserPreferences({
        locale: 'de',
        home_currency: 'EUR',
        interests: ['history', 'food', 'history', 'BAD KEY', 'beaches'],
        updated_at: 'x',
      }),
    ).toEqual({ locale: null, home_currency: 'EUR', interests: ['history', 'food', 'beaches'], saved: true, updated_at: 'x' });
    expect(toUserPreferences({ locale: 'tr', home_currency: 'eur', interests: [] })).toMatchObject({
      locale: 'tr',
      home_currency: null,
    });
  });

  it('localeForLanguagePreference', () => {
    expect(localeForLanguagePreference('system')).toBeNull();
    expect(localeForLanguagePreference('tr')).toBe('tr');
  });
});

describe('useUserPreferences', () => {
  it('reads the own row (owner-only) and returns defaults before the first save', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUserPreferences(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ saved: false, interests: [] });
    const read = mockCalls.find((c) => c.table === 'user_preferences')!;
    expect(read.ops).toContainEqual(['eq', ['user_id', 'u1']]);
    expect(read.ops.some(([m]) => m === 'maybeSingle')).toBe(true);
  });

  it('is disabled while signed out', async () => {
    mockUserId = null;
    const { wrapper } = setup();
    const { result } = renderHook(() => useUserPreferences(), { wrapper });
    await act(async () => undefined);
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockCalls.filter((c) => c.table === 'user_preferences')).toHaveLength(0);
  });
});

describe('useUpdateUserPreferences', () => {
  it('upserts only the given columns for the own user_id', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(['auth', 'session'], { user: { id: 'u1' } });
    const { result } = renderHook(() => useUpdateUserPreferences(), { wrapper });
    let saved!: Awaited<ReturnType<typeof result.current.mutateAsync>>;
    await act(async () => {
      saved = await result.current.mutateAsync({ home_currency: ' eur ', interests: ['food', 'history', 'food'] });
    });
    expect(upserts()).toEqual([
      { payload: { user_id: 'u1', home_currency: 'EUR', interests: ['food', 'history'] }, options: { onConflict: 'user_id' } },
    ]);
    expect(saved).toMatchObject({ home_currency: 'EUR', interests: ['food', 'history'], saved: true });
    expect(qc.getQueryData(userPreferencesKeys.mine('u1'))).toMatchObject({ home_currency: 'EUR' });
  });

  it('validates like the DB CHECKs', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateUserPreferences(), { wrapper });
    await expect(result.current.mutateAsync({ home_currency: 'EURO' })).rejects.toThrow(/ISO 4217/);
    await expect(result.current.mutateAsync({ interests: ['Not Valid'] })).rejects.toThrow(/lower-case/);
    await expect(
      result.current.mutateAsync({ interests: Array.from({ length: 17 }, (_, i) => `k${i}`) }),
    ).rejects.toThrow(/at most 16/);
    expect(upserts()).toHaveLength(0);
  });

  it('is optimistic and rolls back on error', async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(['auth', 'session'], { user: { id: 'u1' } });
    const key = userPreferencesKeys.mine('u1');
    qc.setQueryData(key, toUserPreferences({ locale: 'en', home_currency: 'TRY', interests: ['food'] }));
    mockError = { message: 'boom' };
    const { result } = renderHook(() => useUpdateUserPreferences(), { wrapper });
    act(() => {
      result.current.mutate({ interests: ['nature'] });
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData(key)).toMatchObject({ interests: ['food'], home_currency: 'TRY' });
  });

  it('refuses when signed out', async () => {
    mockUserId = null;
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateUserPreferences(), { wrapper });
    await expect(result.current.mutateAsync({ locale: 'tr' })).rejects.toMatchObject({ code: 'not_authenticated' });
  });
});

describe('useLanguagePreferenceMirror', () => {
  it('saves a CHANGE of the device language (never on mount)', async () => {
    mockRow = { locale: null, home_currency: null, interests: [], updated_at: 'x' };
    const { qc, wrapper } = setup();
    qc.setQueryData(['auth', 'session'], { user: { id: 'u1' } });
    renderHook(() => useLanguagePreferenceMirror({ adoptAccountLocale: false }), { wrapper });
    await waitFor(() => expect(mockCalls.some((c) => c.table === 'user_preferences')).toBe(true));
    expect(upserts()).toHaveLength(0);
    await act(() => setLanguagePreference('tr'));
    await waitFor(() => expect(upserts()).toHaveLength(1));
    expect(upserts()[0]!.payload).toEqual({ user_id: 'u1', locale: 'tr' });
    await act(() => setLanguagePreference('system'));
    await waitFor(() => expect(upserts()).toHaveLength(2));
    expect(upserts()[1]!.payload).toEqual({ user_id: 'u1', locale: null });
  });

  it('adopts the account language once when the device is on System, without echoing it back', async () => {
    mockRow = { locale: 'tr', home_currency: null, interests: [], updated_at: 'x' };
    const { qc, wrapper } = setup();
    qc.setQueryData(['auth', 'session'], { user: { id: 'u1' } });
    expect(getLanguagePreference()).toBe('system');
    renderHook(() => useLanguagePreferenceMirror(), { wrapper });
    await waitFor(() => expect(getLanguagePreference()).toBe('tr'));
    await act(async () => undefined);
    expect(upserts()).toHaveLength(0);
  });
});
