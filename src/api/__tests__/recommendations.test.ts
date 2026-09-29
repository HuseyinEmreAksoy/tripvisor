/**
 * M5 Y1.3 — src/api/recommendations.ts (poi-recommend client).
 *
 * `../supabase` is a REAL supabase-js client over a jest-mocked `fetch`, so
 * the actual `functions.invoke` request and error path are exercised.
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

// M5 Y2.5: the trip-aware hooks read places / create places through
// ./trip-places. Mocked here so this suite never boots the sync engine.
let mockTripPlaces: Array<Record<string, unknown>> = [];
const mockUseTripPlacesArgs: Array<string | undefined> = [];
const mockCreate = jest.fn<(input: Record<string, unknown>) => Promise<Record<string, unknown>>>();
const mockMove = jest.fn<(input: Record<string, unknown>) => Promise<Record<string, unknown>>>();
jest.mock('../trip-places', () => ({
  useTripPlaces: (tripId: string | undefined) => {
    mockUseTripPlacesArgs.push(tripId);
    return { data: tripId ? mockTripPlaces : undefined, isLoading: false };
  },
  useCreateTripPlace: () => ({ mutateAsync: mockCreate }),
  useMoveToDay: () => ({ mutateAsync: mockMove }),
}));

import {
  AddPoiError,
  centerOfPoints,
  fetchRecommendations,
  normalizeRecommendationParams,
  pickPoiSuggestion,
  poiCategoryDefault,
  recommendationCenterFromPlaces,
  recommendationKeys,
  RecommendationsError,
  resolvePoiGooglePlace,
  useAddPoiToTrip,
  useRecommendationCenter,
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
  mockCreate.mockReset();
  mockMove.mockReset();
  mockTripPlaces = [];
  mockUseTripPlacesArgs.length = 0;
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

// ===========================================================================
// M5 Y2.5 — lang default, trip-aware centre, add a card to the trip
// ===========================================================================

const TRIP = '00000000-0000-4000-8000-000000000001';
const ISTANBUL = [
  { lat: 41.0086, lng: 28.9802, day_index: 0 }, // Hagia Sophia
  { lat: 41.0054, lng: 28.9768, day_index: 0 }, // Blue Mosque
  { lat: 41.0256, lng: 28.9744, day_index: 1 }, // Galata
];
const CAPPADOCIA = { lat: 38.6431, lng: 34.8289, day_index: 2 };

function hookWrapper() {
  const client = track(new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }));
  return ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
}

describe('Y2.5 lang default', () => {
  it('uses the app language when no lang is given, and still maps explicit tags', () => {
    expect(normalizeRecommendationParams({ lat: 1, lng: 2, interests: ['food'] }).lang).toBe('en');
    expect(normalizeRecommendationParams({ lat: 1, lng: 2, interests: ['food'], lang: 'TR' }).lang).toBe('tr');
  });
});

describe('Y2.5 search centre (pure)', () => {
  it('a day centres on its own stops; a day without stops falls back to the trip', () => {
    const day0 = recommendationCenterFromPlaces(ISTANBUL, 0);
    expect(day0.source).toBe('day');
    expect(day0.placeCount).toBe(2);
    expect(day0.center!.lat).toBeCloseTo(41.007, 3);
    const day5 = recommendationCenterFromPlaces(ISTANBUL, 5);
    expect(day5.source).toBe('trip');
    expect(day5.placeCount).toBe(3);
  });

  it('ignores tombstones and bad coordinates; nothing to centre on gives none', () => {
    expect(recommendationCenterFromPlaces([{ lat: 41, lng: 29, deleted: true }, { lat: NaN, lng: 1 }])).toEqual({
      center: null,
      source: 'none',
      placeCount: 0,
    });
  });

  it('a two-city trip centres on the busier city (medoid), not the empty space between', () => {
    const c = centerOfPoints([...ISTANBUL, CAPPADOCIA])!;
    expect(ISTANBUL.some((p) => p.lat === c.lat && p.lng === c.lng)).toBe(true);
  });

  it('handles the antimeridian', () => {
    const c = centerOfPoints([{ lat: -17, lng: 179.9 }, { lat: -17, lng: -179.9 }])!;
    expect(Math.abs(c.lng)).toBeGreaterThan(179.8);
  });
});

describe('Y2.5 useRecommendations({ tripId | center, ... })', () => {
  it('centres a trip query on the trip places', async () => {
    mockTripPlaces = ISTANBUL;
    mockFetch.mockResolvedValueOnce(jsonResponse(200, OK));
    const { result } = renderHook(() => useRecommendations({ tripId: TRIP, dayIndex: 0, interests: ['history'] }), {
      wrapper: hookWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastBody()).toMatchObject({ action: 'search', lat: 41.007, lng: 28.979, interests: ['history'], lang: 'en' });
    expect(mockUseTripPlacesArgs).toContain(TRIP);
  });

  it('an explicit centre wins and the trip places are not read', async () => {
    mockTripPlaces = ISTANBUL;
    mockFetch.mockResolvedValueOnce(jsonResponse(200, OK));
    const { result } = renderHook(
      () => useRecommendations({ tripId: TRIP, center: { lat: 38.6431, lng: 34.8289 }, interests: ['nature'] }),
      { wrapper: hookWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(lastBody()).toMatchObject({ lat: 38.643, lng: 34.829 });
    expect(mockUseTripPlacesArgs.every((a) => a === undefined)).toBe(true);
  });

  it('holds while the trip has no stops, and reports why', () => {
    const wrapper = hookWrapper();
    const q = renderHook(() => useRecommendations({ tripId: TRIP, interests: ['food'] }), { wrapper });
    const c = renderHook(() => useRecommendationCenter({ tripId: TRIP }), { wrapper });
    expect(q.result.current.fetchStatus).toBe('idle');
    expect(c.result.current).toEqual({ center: null, source: 'none', placeCount: 0, loading: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

const CARD = {
  name: 'Blue Mosque',
  originalName: 'Sultanahmet Camii',
  lat: 41.00538,
  lng: 28.97682,
  kind: 'historic=mosque',
  interests: ['history' as const],
};

function suggestion(placeId: string, mainText: string) {
  return { placeId, mainText, secondaryText: 'Istanbul' };
}

describe('Y2.5 resolvePoiGooglePlace (quota-metered places-autocomplete)', () => {
  it('sends the card name, a 1 km bias around the card, a session token and the app language', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { suggestions: [suggestion('A', 'Blue Mosque Cafe'), suggestion('B', 'Blue Mosque')] }),
    );
    const match = await resolvePoiGooglePlace(CARD);
    expect(String(mockFetch.mock.calls[0]![0])).toBe('http://supabase.test/functions/v1/places-autocomplete');
    const body = lastBody();
    expect(body).toMatchObject({
      input: 'Blue Mosque',
      locationBias: { lat: 41.00538, lng: 28.97682, radiusMeters: 1000 },
      lang: 'en',
    });
    expect(String(body.sessionToken)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(match).toEqual({ placeId: 'B', mainText: 'Blue Mosque', secondaryText: 'Istanbul', query: 'Blue Mosque' });
  });

  it('retries once with the local name (same session) when the card name finds nothing', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { suggestions: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { suggestions: [suggestion('C', 'Sultanahmet Camii')] }));
    const match = await resolvePoiGooglePlace(CARD, { sessionToken: '11111111-1111-4111-8111-111111111111' });
    expect(match.placeId).toBe('C');
    expect(match.query).toBe('Sultanahmet Camii');
    const sent = mockFetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as { sessionToken: string });
    expect(sent.map((b) => b.sessionToken)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('maps failures to stable AddPoiError codes', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(429, { error: { code: 'quota_exceeded', message: 'Daily limit reached' } }),
    );
    await expect(resolvePoiGooglePlace(CARD)).rejects.toMatchObject({ name: 'AddPoiError', code: 'quota_exceeded' });
    mockFetch.mockResolvedValueOnce(jsonResponse(500, { error: { code: 'server_misconfigured', message: 'no key' } }));
    await expect(resolvePoiGooglePlace(CARD)).rejects.toMatchObject({ code: 'places_unavailable' });
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(200, { suggestions: [] })));
    await expect(resolvePoiGooglePlace(CARD)).rejects.toMatchObject({ code: 'no_match' });
    await expect(resolvePoiGooglePlace({ name: 'X', lat: 200, lng: 0 })).rejects.toBeInstanceOf(AddPoiError);
  });

  it('matches names case- and diacritics-insensitively (Turkish too)', () => {
    const s = [suggestion('A', 'Galata Tower'), suggestion('B', 'GALATA KULESİ')];
    expect(pickPoiSuggestion(s, ['Galata Kulesi'])!.placeId).toBe('B');
    expect(pickPoiSuggestion(s, ['Something else'])!.placeId).toBe('A');
    expect(pickPoiSuggestion([], ['x'])).toBeNull();
  });
});

describe('Y2.5 poiCategoryDefault', () => {
  it('maps OSM kinds (then interests) onto the add-place categories', () => {
    expect(poiCategoryDefault({ name: 'x', lat: 0, lng: 0, kind: 'tourism=museum' })).toEqual({
      category: 'museum',
      durationMinutes: 120,
    });
    expect(poiCategoryDefault({ name: 'x', lat: 0, lng: 0, kind: 'amenity=cafe' })).toEqual({
      category: 'restaurant',
      durationMinutes: 90,
    });
    expect(poiCategoryDefault({ name: 'x', lat: 0, lng: 0, kind: 'historic=mosque' }).category).toBe('religious_site');
    expect(poiCategoryDefault({ name: 'x', lat: 0, lng: 0, kind: 'historic=castle' }).category).toBe('attraction');
    expect(poiCategoryDefault({ name: 'x', lat: 0, lng: 0, kind: null, interests: ['nature'] }).category).toBe('nature');
    expect(poiCategoryDefault({ name: 'x', lat: 0, lng: 0 })).toEqual({ category: 'general', durationMinutes: 60 });
  });
});

describe('Y2.5 useAddPoiToTrip', () => {
  it('resolves, creates through the create hook with OSM coords + card name, then schedules the day', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { suggestions: [suggestion('ChIJ_blue', 'Blue Mosque')] }));
    mockCreate.mockResolvedValueOnce({ id: 'row-1', trip_id: TRIP });
    mockMove.mockResolvedValueOnce({ id: 'row-1', day_index: 1 });
    const { result } = renderHook(() => useAddPoiToTrip(TRIP), { wrapper: hookWrapper() });
    let out: { googlePlaceId: string; matchedName: string; scheduled: boolean | null } | undefined;
    await act(async () => {
      out = await result.current.mutateAsync({ poi: CARD, dayIndex: 1 });
    });
    expect(mockCreate).toHaveBeenCalledWith({
      trip_id: TRIP,
      google_place_id: 'ChIJ_blue',
      user_title: 'Blue Mosque',
      category: 'religious_site',
      visit_duration_minutes: 45,
      lat: 41.00538,
      lng: 28.97682,
    });
    expect(mockMove).toHaveBeenCalledWith({ id: 'row-1', tripId: TRIP, toDayIndex: 1 });
    expect(out).toMatchObject({ googlePlaceId: 'ChIJ_blue', matchedName: 'Blue Mosque', scheduled: true });
  });

  it('Ideas when no day is given; a duplicate is refused before any write', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse(200, { suggestions: [suggestion('ChIJ_blue', 'Blue Mosque')] })),
    );
    mockCreate.mockResolvedValue({ id: 'row-2', trip_id: TRIP });
    const { result } = renderHook(() => useAddPoiToTrip(TRIP), { wrapper: hookWrapper() });
    let ideas: { scheduled: boolean | null } | undefined;
    await act(async () => {
      ideas = await result.current.mutateAsync({ poi: CARD });
    });
    expect(ideas?.scheduled).toBeNull();
    expect(mockMove).not.toHaveBeenCalled();

    mockCreate.mockClear();
    let err: unknown;
    await act(async () => {
      err = await result.current
        .mutateAsync({ poi: CARD, existingGooglePlaceIds: ['ChIJ_other', 'ChIJ_blue'] })
        .catch((e: unknown) => e);
    });
    expect(err).toBeInstanceOf(AddPoiError);
    expect((err as AddPoiError).code).toBe('already_in_trip');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('reuses a match resolved by the detail sheet (no second metered search)', async () => {
    mockCreate.mockResolvedValueOnce({ id: 'row-3', trip_id: TRIP });
    const { result } = renderHook(() => useAddPoiToTrip(TRIP), { wrapper: hookWrapper() });
    await act(async () => {
      await result.current.mutateAsync({
        poi: CARD,
        match: { placeId: 'ChIJ_pre', mainText: 'Blue Mosque', secondaryText: '', query: 'Blue Mosque' },
      });
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ google_place_id: 'ChIJ_pre' }));
  });

  it('a failed create is create_failed; a missing trip is invalid_input (no Places call)', async () => {
    const { result } = renderHook(() => useAddPoiToTrip(undefined), { wrapper: hookWrapper() });
    let err: unknown;
    await act(async () => {
      err = await result.current.mutateAsync({ poi: CARD }).catch((e: unknown) => e);
    });
    expect((err as AddPoiError).code).toBe('invalid_input');
    expect(mockFetch).not.toHaveBeenCalled();

    mockFetch.mockResolvedValueOnce(jsonResponse(200, { suggestions: [suggestion('ChIJ_blue', 'Blue Mosque')] }));
    mockCreate.mockRejectedValueOnce(new Error('offline queue full'));
    await act(async () => {
      err = await result.current.mutateAsync({ poi: CARD, tripId: TRIP }).catch((e: unknown) => e);
    });
    expect((err as AddPoiError).code).toBe('create_failed');
  });
});
