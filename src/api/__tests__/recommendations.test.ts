/**
 * M5 Y1.3 — src/api/recommendations.ts (poi-recommend client).
 *
 * `../supabase` is a REAL supabase-js client over a jest-mocked `fetch`, so
 * the actual `functions.invoke` request and error path are exercised.
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

import {
  fetchRecommendations,
  normalizeRecommendationParams,
  recommendationKeys,
  RecommendationsError,
  useRecommendations,
} from '../recommendations';

const ITEM = {
  id: 'osm:relation/18055570',
  source: 'osm',
  osm: { type: 'relation', id: 18055570 },
  name: 'Blue Mosque',
  originalName: 'Sultanahmet Camii',
  lat: 41.00538,
  lng: 28.97682,
  distanceM: 13,
  interests: ['history'],
  kind: 'historic=mosque',
  tags: { historic: 'mosque' },
  wikidata: 'Q80541',
  wiki: {
    lang: 'en',
    title: 'Blue Mosque, Istanbul',
    extract: 'The Sultan Ahmed Mosque…',
    description: null,
    thumbUrl: 'https://upload.wikimedia.org/x.jpg',
    url: 'https://en.wikipedia.org/wiki/Blue_Mosque,_Istanbul',
  },
  score: 0.957,
};

const OK = {
  items: [ITEM],
  center: { lat: 41.005, lng: 28.977 },
  radiusM: 1500,
  interests: ['food', 'history'],
  lang: 'en',
  attribution: {
    osm: '© OpenStreetMap contributors',
    osmUrl: 'https://www.openstreetmap.org/copyright',
    wikipedia: 'Wikipedia (CC BY-SA 4.0)',
    wikipediaUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  degraded: null,
  meta: { contractVersion: 1, cache: 'miss', tiles: 4, upstream: 'overpass', instance: 'overpass-api.de' },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function lastBody(): Record<string, unknown> {
  const [, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]!;
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

// The hook uses a 6 h gcTime: clear every client so no GC timer outlives the test.
const clients: QueryClient[] = [];
function track(client: QueryClient): QueryClient {
  clients.push(client);
  return client;
}

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(() => {
  clients.splice(0).forEach((c) => c.clear());
});

describe('normalizeRecommendationParams / keys', () => {
  it('rounds the centre, dedupes + sorts interests, maps the language', () => {
    expect(
      normalizeRecommendationParams({ lat: 41.00541, lng: 28.97679, interests: ['history', 'food', 'history'], lang: 'tr-TR' }),
    ).toEqual({ lat: 41.005, lng: 28.977, radiusM: 1500, interests: ['food', 'history'], lang: 'tr', limit: 30, enrich: true });
  });

  it('gives order-insensitive keys under the memory-only "recommendations" root', () => {
    const a = recommendationKeys.search({ lat: 41.0054, lng: 28.9768, interests: ['food', 'history'] });
    const b = recommendationKeys.search({ lat: 41.00541, lng: 28.97679, interests: ['history', 'food'] });
    expect(a).toEqual(b);
    expect(a[0]).toBe('recommendations');
  });
});

describe('fetchRecommendations', () => {
  it('POSTs the normalised search to poi-recommend and parses the contract', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, OK));
    const res = await fetchRecommendations({ lat: 41.0054, lng: 28.9768, interests: ['history', 'food'] });
    expect(String(mockFetch.mock.calls[0]![0])).toBe('http://supabase.test/functions/v1/poi-recommend');
    expect(lastBody()).toEqual({
      action: 'search',
      lat: 41.005,
      lng: 28.977,
      radiusM: 1500,
      interests: ['food', 'history'],
      lang: 'en',
      limit: 30,
      enrich: true,
    });
    expect(res.items[0]!.name).toBe('Blue Mosque');
    expect(res.attribution.osm).toBe('© OpenStreetMap contributors');
  });

  it('drops unknown future interest keys instead of failing', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { ...OK, items: [{ ...ITEM, interests: ['history', 'stargazing'] }] }));
    const res = await fetchRecommendations({ lat: 41, lng: 29, interests: ['history'] });
    expect(res.items[0]!.interests).toEqual(['history']);
  });

  it('maps quota_exceeded to a typed RecommendationsError', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(429, { error: { code: 'quota_exceeded', message: 'Daily recommendation limit reached', kind: 'poi_requests', limit: 40 } }),
    );
    const err = await fetchRecommendations({ lat: 41, lng: 29, interests: ['food'] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RecommendationsError);
    expect((err as RecommendationsError).code).toBe('quota_exceeded');
    expect((err as RecommendationsError).status).toBe(429);
  });

  it('rejects a drifted payload', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { items: [{ id: 1 }] }));
    await expect(fetchRecommendations({ lat: 41, lng: 29, interests: ['food'] })).rejects.toThrow();
  });
});

describe('useRecommendations', () => {
  function wrapper({ children }: { children: React.ReactNode }) {
    const client = track(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    return React.createElement(QueryClientProvider, { client }, children);
  }

  it('fetches when params are ready', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, OK));
    const { result } = renderHook(
      () => useRecommendations({ lat: 41.0054, lng: 28.9768, interests: ['history', 'food'] }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.items).toHaveLength(1);
  });

  it('holds while params are missing or no interest is selected', () => {
    const a = renderHook(() => useRecommendations(undefined), { wrapper });
    const b = renderHook(() => useRecommendations({ lat: 41, lng: 29, interests: [] }), { wrapper });
    expect(a.result.current.fetchStatus).toBe('idle');
    expect(b.result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not retry a kill-switch answer', async () => {
    const client = track(new QueryClient());
    mockFetch.mockResolvedValue(
      jsonResponse(503, { error: { code: 'recommendations_disabled', message: 'Recommendations are turned off for now.' } }),
    );
    const { result } = renderHook(() => useRecommendations({ lat: 41, lng: 29, interests: ['food'] }), {
      wrapper: ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client }, children),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as RecommendationsError).code).toBe('recommendations_disabled');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
