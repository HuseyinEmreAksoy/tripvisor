/**
 * M5 Y1.3 — src/api/fx.ts (fx-rates client).
 *
 * `../supabase` is replaced by a REAL supabase-js client whose `fetch` is a
 * jest mock, so these tests exercise the actual `functions.invoke` request
 * (URL, method, JSON body) and the real FunctionsHttpError -> FxError path.
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
  FxError,
  fetchFxCurrencies,
  fetchFxRate,
  fetchFxRates,
  fxKeys,
  isPermanentFxError,
  useFxRate,
} from '../fx';

const RATES_OK = {
  base: 'EUR',
  date: '2026-09-26',
  rateDate: '2026-09-25',
  rates: { TRY: 55.7975 },
  rate: 55.7975,
  source: 'frankfurter-ecb',
  stale: false,
  meta: { contractVersion: 1, cache: 'hit' },
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function lastCall(): { url: string; method: string; body: Record<string, unknown> } {
  const [input, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]!;
  return {
    url: String(input),
    method: init?.method ?? 'GET',
    body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
  };
}

// The hooks use 24 h gcTime: clear every client so no GC timer outlives the test.
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

describe('fetchFxRates', () => {
  it('POSTs a normalised body to the fx-rates function and returns the parsed contract', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, RATES_OK));
    const res = await fetchFxRates({ base: 'eur', date: '2026-09-26', quotes: ['try', 'TRY'] });
    expect(res.rate).toBe(55.7975);
    expect(res.rateDate).toBe('2026-09-25');
    const call = lastCall();
    expect(call.url).toBe('http://supabase.test/functions/v1/fx-rates');
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ base: 'EUR', date: '2026-09-26', quotes: ['TRY'] });
  });

  it('asks for the full latest EUR table by default', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { ...RATES_OK, rate: undefined, rates: { TRY: 55.7, USD: 1.1 } }));
    await fetchFxRates();
    expect(lastCall().body).toEqual({ base: 'EUR', date: 'latest' });
  });

  it('maps the error envelope to a typed FxError', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(422, { error: { code: 'unsupported_currency', message: 'No rate available for XYZ' } }),
    );
    const err = await fetchFxRates({ quotes: ['XYZ'] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FxError);
    expect((err as FxError).code).toBe('unsupported_currency');
    expect((err as FxError).status).toBe(422);
    expect(isPermanentFxError(err)).toBe(true);
    expect(isPermanentFxError(new FxError('rates_unavailable', 'x', 503))).toBe(false);
  });

  it('fails loudly on contract drift', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { base: 'EUR', rates: { TRY: 'lots' } }));
    await expect(fetchFxRates()).rejects.toThrow();
  });
});

describe('fetchFxRate', () => {
  it('returns `to` per 1 `from` for the day', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { ...RATES_OK, base: 'TRY', rates: { EUR: 1 / 55.7975 }, rate: 1 / 55.7975 }),
    );
    const pair = await fetchFxRate('try', 'eur', '2026-09-26');
    expect(pair).toEqual({
      from: 'TRY',
      to: 'EUR',
      rate: 1 / 55.7975,
      date: '2026-09-26',
      rateDate: '2026-09-25',
      source: 'frankfurter-ecb',
      stale: false,
    });
    expect(lastCall().body).toEqual({ base: 'TRY', date: '2026-09-26', quotes: ['EUR'] });
  });

  it('needs no network for the identity pair', async () => {
    const pair = await fetchFxRate('EUR', 'eur', '2026-09-01');
    expect(pair.rate).toBe(1);
    expect(pair.date).toBe('2026-09-01');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('turns a missing quote into unsupported_currency', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, { ...RATES_OK, rates: {}, rate: undefined, missing: ['XYZ'] }));
    await expect(fetchFxRate('EUR', 'XYZ')).rejects.toMatchObject({ code: 'unsupported_currency' });
  });
});

describe('fetchFxCurrencies', () => {
  it('requests the currencies action', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, {
        date: '2026-09-29',
        rateDate: '2026-09-28',
        currencies: [
          { code: 'AED', ecb: false },
          { code: 'EUR', ecb: true },
        ],
        stale: false,
        meta: { contractVersion: 1, cache: 'hit' },
      }),
    );
    const res = await fetchFxCurrencies();
    expect(res.currencies.map((c) => c.code)).toEqual(['AED', 'EUR']);
    expect(lastCall().body).toEqual({ action: 'currencies' });
  });
});

describe('fxKeys', () => {
  it('is stable across code case and quote order', () => {
    expect(fxKeys.rates({ base: 'try', quotes: ['usd', 'EUR'] })).toEqual(
      fxKeys.rates({ base: 'TRY', date: 'latest', quotes: ['EUR', 'USD'] }),
    );
    expect(fxKeys.rates({})[0]).toBe('fx');
  });
});

describe('useFxRate', () => {
  function wrapper({ children }: { children: React.ReactNode }) {
    const client = track(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    return React.createElement(QueryClientProvider, { client }, children);
  }

  it('resolves the pair through the hook', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(200, RATES_OK));
    const { result } = renderHook(() => useFxRate('EUR', 'TRY', '2026-09-26'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.rate).toBe(55.7975);
  });

  it('stays idle until both codes are known', () => {
    const { result } = renderHook(() => useFxRate('EUR', undefined), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
