/**
 * Wave-2 sweep — useTripLegs (src/api/routes.ts) must never lose DAY legs to
 * PostgREST's max_rows (1000): the matrix cache (day_index -1, up to 600 rows
 * per mode) is read separately from the day legs.
 *
 * `../supabase` is a REAL supabase-js client over a jest-mocked `fetch`.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
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

import { useTripLegs } from '../routes';

const TRIP = '00000000-0000-4000-8000-000000000001';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const leg = (id: string, dayIndex: number) => ({
  id,
  trip_id: TRIP,
  from_place_id: `${id}-a`,
  to_place_id: `${id}-b`,
  day_index: dayIndex,
  transport_mode: 'driving',
  duration_seconds: 60,
  distance_meters: 100,
  polyline: null,
  transit_steps: null,
  source: 'ors',
  computed_at: '2026-09-29T00:00:00Z',
});

const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
  return { wrapper };
}

beforeEach(() => {
  mockFetch.mockReset();
});
afterEach(() => {
  clients.splice(0).forEach((c) => c.clear());
});

describe('useTripLegs (Wave-2 sweep)', () => {
  it('reads day legs and matrix-cache rows separately, so a full cache page cannot drop day legs', async () => {
    // A cache read truncated at the 1000-row cap, as PostgREST would return it.
    const cache = Array.from({ length: 1000 }, (_, i) => leg(`c${i}`, -1));
    const days = [leg('d0', 0), leg('d1', 0), leg('d2', 1)];
    mockFetch.mockImplementation(async (input) => {
      const url = decodeURIComponent(String(input));
      if (url.includes('day_index=gte.0')) return jsonResponse(200, days);
      if (url.includes('day_index=lt.0')) return jsonResponse(200, cache);
      return jsonResponse(500, { message: `unexpected ${url}` });
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripLegs(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const urls = mockFetch.mock.calls.map(([input]) => decodeURIComponent(String(input)));
    expect(urls).toHaveLength(2);
    for (const u of urls) expect(u).toContain(`trip_id=eq.${TRIP}`);

    const data = result.current.data!;
    expect(data).toHaveLength(1003);
    // Every day leg survives, last (hop lookups are last-wins), in server order.
    expect(data.slice(-3).map((l) => l.id)).toEqual(['d0', 'd1', 'd2']);
    expect(data.slice(0, 1000).every((l) => l.day_index === -1)).toBe(true);
  });

  it('a failed read fails the query (never a silent partial route)', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = decodeURIComponent(String(input));
      if (url.includes('day_index=gte.0')) return jsonResponse(500, { message: 'boom', code: 'XX000' });
      return jsonResponse(200, []);
    });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripLegs(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
