/**
 * M5 Y2.5 — src/api/share.ts (share-trip contract v3 client).
 *
 * `../supabase` is a REAL supabase-js client over a jest-mocked `fetch`, so
 * the actual `functions.invoke` request and error envelope paths run.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockFetch = jest.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

jest.mock('../supabase', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = jest.requireActual('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
  return {
    supabase: createClient('http://supabase.test', 'anon-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => mockFetch(input, init) },
    }),
  };
});

import {
  DEFAULT_SHARE_SETTINGS,
  rebaseSignedStorageUrl,
  SHARE_CONTRACT_VERSION,
  ShareLinkError,
  shareKeys,
  useCreateShareLink,
  useCurrentShareLink,
  useRevokeShareLink,
  useSharedTrip,
  useTripShareSettings,
  useUpdateShareSettings,
  type CurrentShareLink,
} from '../share';

const TRIP = '00000000-0000-4000-8000-000000000001';
const LINK: CurrentShareLink = {
  token: 'live-token-value-123456789',
  createdAt: '2026-09-20T10:00:00Z',
  settings: { showItinerary: true, showExpenses: false, showMemories: false },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function bodies(): Array<Record<string, unknown>> {
  return mockFetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
}

const clients: QueryClient[] = [];
function setup(options: { retry?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: options.retry === false ? { retry: false } : {}, mutations: { retry: false } },
  });
  clients.push(client);
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  clients.splice(0).forEach((c) => c.clear());
});

describe('constants', () => {
  it('matches the server defaults and contract', () => {
    expect(DEFAULT_SHARE_SETTINGS).toEqual({ showItinerary: true, showExpenses: false, showMemories: false });
    expect(SHARE_CONTRACT_VERSION).toBe(3);
    expect(shareKeys.current(TRIP)).toEqual(['share', 'current', TRIP]);
  });
});

describe('useCurrentShareLink / useTripShareSettings', () => {
  it('reads the owner current link with op "current"', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { share: LINK, meta: { contractVersion: 3 } }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useCurrentShareLink(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(LINK);
    expect(String(mockFetch.mock.calls[0]![0])).toBe('http://supabase.test/functions/v1/share-trip');
    expect(bodies()[0]).toEqual({ op: 'current', tripId: TRIP });
  });

  it('returns null when the trip has no active link; settings select → null', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { share: null }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripShareSettings(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('selects only the toggles from the same query', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { share: LINK }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripShareSettings(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(LINK.settings);
  });

  it('a collaborator gets a typed not_owner error and no retry', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(403, { error: { code: 'not_owner', message: 'Only the trip owner can manage public share links' } }),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useCurrentShareLink(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ShareLinkError);
    expect((result.current.error as ShareLinkError).code).toBe('not_owner');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('holds when disabled (e.g. the caller is not the owner) or without a trip', () => {
    const { wrapper } = setup();
    const a = renderHook(() => useCurrentShareLink(TRIP, { enabled: false }), { wrapper });
    const b = renderHook(() => useTripShareSettings(undefined), { wrapper });
    expect(a.result.current.fetchStatus).toBe('idle');
    expect(b.result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects a drifted payload', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { share: { token: 'x' } }));
    const { wrapper } = setup({ retry: false });
    const { result } = renderHook(() => useCurrentShareLink(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe('useUpdateShareSettings', () => {
  it('sends only the given toggles and updates the cache optimistically, then from the server', async () => {
    const { client, wrapper } = setup();
    client.setQueryData(shareKeys.current(TRIP), LINK);
    let resolveFetch: (r: Response) => void = () => undefined;
    mockFetch.mockImplementationOnce(() => new Promise<Response>((r) => { resolveFetch = r; }));
    const { result } = renderHook(() => useUpdateShareSettings(TRIP), { wrapper });

    act(() => {
      result.current.mutate({ showMemories: true });
    });
    await waitFor(() =>
      expect(client.getQueryData<CurrentShareLink>(shareKeys.current(TRIP))?.settings.showMemories).toBe(true),
    );
    expect(bodies()[0]).toEqual({ op: 'update_settings', tripId: TRIP, settings: { showMemories: true } });

    const server = { ...LINK, settings: { ...LINK.settings, showMemories: true } };
    await act(async () => {
      resolveFetch(jsonResponse(200, { share: server, updated: 1, meta: { contractVersion: 3 } }));
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(shareKeys.current(TRIP))).toEqual(server);
  });

  it('rolls the toggle back when the server refuses', async () => {
    const { client, wrapper } = setup();
    client.setQueryData(shareKeys.current(TRIP), LINK);
    mockFetch.mockResolvedValueOnce(
      jsonResponse(404, { error: { code: 'no_active_link', message: 'This trip has no active share link' } }),
    );
    const { result } = renderHook(() => useUpdateShareSettings(TRIP), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ showExpenses: true, token: LINK.token }).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.error).toBeInstanceOf(ShareLinkError));
    expect((result.current.error as ShareLinkError).code).toBe('no_active_link');
    expect(client.getQueryData(shareKeys.current(TRIP))).toEqual(LINK);
    expect(bodies()[0]).toEqual({
      op: 'update_settings',
      tripId: TRIP,
      token: LINK.token,
      settings: { showExpenses: true },
    });
  });

  it('refuses an empty patch without a request', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUpdateShareSettings(TRIP), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({}).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('useCreateShareLink / useRevokeShareLink', () => {
  it('mutate() keeps the v2 body; mutate({ settings }) adds the toggles and primes the current link', async () => {
    const { client, wrapper } = setup();
    const created = { token: 'new-token-value-1234567890', createdAt: '2026-09-29T09:00:00Z', settings: { ...LINK.settings, showMemories: true } };
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { token: 'v2-token-value-123456789' }))
      .mockResolvedValueOnce(jsonResponse(200, created));
    const { result } = renderHook(() => useCreateShareLink(TRIP), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    await act(async () => {
      await result.current.mutateAsync({ settings: { showMemories: true } });
    });
    expect(bodies()[0]).toEqual({ op: 'create', tripId: TRIP });
    expect(bodies()[1]).toEqual({ op: 'create', tripId: TRIP, settings: { showMemories: true } });
    expect(client.getQueryData(shareKeys.current(TRIP))).toEqual(created);
  });

  it('revoking every link clears the current link right away', async () => {
    const { client, wrapper } = setup();
    client.setQueryData(shareKeys.current(TRIP), LINK);
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { revoked: 1 }));
    const { result } = renderHook(() => useRevokeShareLink(TRIP), { wrapper });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(client.getQueryData(shareKeys.current(TRIP))).toBeNull();
    expect(bodies()[0]).toEqual({ op: 'revoke', tripId: TRIP });
  });
});

describe('useSharedTrip (anonymous, v3 payload)', () => {
  it('passes the optional v3 sections through', async () => {
    const payload = {
      trip: { title: 'T', start_date: null, end_date: null, daily_hours_budget: 8, transport_mode: 'driving', timezone: null },
      places: [],
      legs: [],
      sections: { itinerary: false, expenses: true, memories: false },
      expenses: {
        homeCurrency: 'TRY',
        count: 1,
        totals: { actual: 10, estimated: 0 },
        byCategory: [{ category: 'food', actual: 10, estimated: 0 }],
        byCurrency: [{ currency: 'TRY', actual: 10, estimated: 0, count: 1 }],
        pending: { count: 0, actualByCurrency: {}, estimatedByCurrency: {} },
      },
      meta: { contractVersion: 3 },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(200, payload));
    const { wrapper } = setup();
    const { result } = renderHook(() => useSharedTrip('validtoken12345678901234'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.sections?.expenses).toBe(true);
    expect(result.current.data?.expenses?.homeCurrency).toBe('TRY');
    expect(result.current.data?.memories).toBeUndefined();
    expect(bodies()[0]).toEqual({ op: 'read', token: 'validtoken12345678901234' });
  });

  it('re-bases signed memory photo URLs onto this app Supabase URL (local stack signs on kong:8000)', async () => {
    const signed = (p: string) => `http://kong:8000/storage/v1/object/sign/trip-memories/${p}?token=abc`;
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        trip: { title: 'T' },
        places: [],
        legs: [],
        sections: { itinerary: true, expenses: false, memories: true },
        memories: {
          journal: [],
          reviews: [],
          photos: [
            { id: 'p1', dayIndex: 0, placeId: null, caption: null, takenAt: null, width: 1, height: 1, url: signed('t/a/p1.jpg'), thumbUrl: signed('t/a/p1_t.jpg') },
          ],
          photoUrlExpiresAt: '2030-01-01T00:00:00Z',
          truncated: false,
        },
        meta: { contractVersion: 3 },
      }),
    );
    const { wrapper } = setup();
    const { result } = renderHook(() => useSharedTrip('validtoken12345678901234'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const photo = result.current.data!.memories!.photos[0]!;
    expect(photo.url).toBe('http://supabase.test/storage/v1/object/sign/trip-memories/t/a/p1.jpg?token=abc');
    expect(photo.thumbUrl).toBe('http://supabase.test/storage/v1/object/sign/trip-memories/t/a/p1_t.jpg?token=abc');
    expect(rebaseSignedStorageUrl('https://x.test/other/path', 'http://supabase.test')).toBe('https://x.test/other/path');
  });

  it('a revoked link reads as null', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(404, { error: { code: 'not_found', message: 'gone' } }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useSharedTrip('revokedtoken1234567890123'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
});
