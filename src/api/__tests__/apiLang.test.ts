/**
 * M5 Y2.5 — the app language reaches the Edge Functions as `lang`
 * (places-autocomplete, place-details, ai-itinerary, ai-edit).
 *
 * `../supabase` is a REAL supabase-js client over a jest-mocked `fetch`.
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

import { setLanguagePreference } from '@/i18n';
import { requestLang, toApiLang } from '../_lang';
import { fetchPlacesAutocomplete, usePlaceDetails, usePlacesAutocomplete } from '../places';
import { useAiEditTrip, useGenerateItinerary, useGroundPlaces } from '../ai';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function bodyOf(call: number): Record<string, unknown> {
  const [, init] = mockFetch.mock.calls[call]!;
  return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
}

const clients: QueryClient[] = [];
function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  return React.createElement(QueryClientProvider, { client }, children);
}

const SESSION = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  mockFetch.mockReset();
});

afterEach(async () => {
  clients.splice(0).forEach((c) => c.clear());
  await act(() => setLanguagePreference('system'));
});

describe('requestLang / toApiLang', () => {
  it('follows the app language and narrows tags to en | tr', async () => {
    expect(requestLang()).toBe('en');
    await act(() => setLanguagePreference('tr'));
    expect(requestLang()).toBe('tr');
    expect(toApiLang(undefined)).toBe('tr');
    expect(toApiLang('en-GB')).toBe('en');
    expect(toApiLang('tr-TR')).toBe('tr');
    expect(toApiLang('de')).toBe('en');
  });
});

describe('places', () => {
  it('fetchPlacesAutocomplete sends the app language (explicit lang wins)', async () => {
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(200, { suggestions: [] })));
    await act(() => setLanguagePreference('tr'));
    await fetchPlacesAutocomplete({ input: 'Galata', sessionToken: SESSION });
    await fetchPlacesAutocomplete({ input: 'Galata', sessionToken: SESSION, lang: 'en' });
    expect(bodyOf(0)).toMatchObject({ input: 'Galata', sessionToken: SESSION, lang: 'tr' });
    expect(bodyOf(1).lang).toBe('en');
  });

  it('usePlacesAutocomplete and usePlaceDetails send lang', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(200, { suggestions: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { place: null }));
    const a = renderHook(() => usePlacesAutocomplete({ input: 'Galata', sessionToken: SESSION }), { wrapper });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    const d = renderHook(() => usePlaceDetails({ placeId: 'ChIJ_1', sessionToken: SESSION, fields: ['id'] }), {
      wrapper,
    });
    await waitFor(() => expect(d.result.current.isSuccess).toBe(true));
    expect(bodyOf(0)).toMatchObject({ input: 'Galata', lang: 'en' });
    expect(bodyOf(1)).toMatchObject({ placeId: 'ChIJ_1', fields: ['id'], lang: 'en' });
  });
});

describe('ai', () => {
  it('itinerary, edit and ground requests carry the app language', async () => {
    await act(() => setLanguagePreference('tr'));
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(200, { runId: 'r', status: 'ok' })));
    const plan = renderHook(() => useGenerateItinerary(), { wrapper });
    const edit = renderHook(() => useAiEditTrip(), { wrapper });
    const ground = renderHook(() => useGroundPlaces(), { wrapper });
    await act(async () => {
      await plan.result.current.mutateAsync({ prompt: 'Three days in Istanbul please' });
      await edit.result.current.mutateAsync({ tripId: '00000000-0000-4000-8000-000000000001', instruction: 'Add a museum' });
      await ground.result.current.mutateAsync({ names: ['Galata Tower'] });
    });
    expect(bodyOf(0)).toMatchObject({ prompt: 'Three days in Istanbul please', lang: 'tr' });
    expect(bodyOf(1)).toMatchObject({ action: 'edit', lang: 'tr' });
    expect(bodyOf(2)).toMatchObject({ action: 'ground', lang: 'tr' });
  });
});
