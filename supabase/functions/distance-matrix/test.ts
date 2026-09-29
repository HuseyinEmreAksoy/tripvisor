// Run: deno test --allow-env --allow-net supabase/functions/distance-matrix/test.ts
// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import process from 'node:process';
import { test } from 'node:test';
// @ts-ignore -- Deno `.ts`-suffixed import
import { handler as rawHandler } from './index.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { _setQuotaRpcForTests, _setTokenVerifierForTests } from '../_shared/auth.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { _resetRoutingStateForTests } from '../_shared/routing.ts';

// Audit #2: the function requires a real user. Every request below is
// authenticated as a fixed user through the verifier hook (unless it sets
// its own Authorization), and the quota RPC passes unless a test overrides it.
const TEST_USER_ID = '00000000-0000-4000-8000-0000000000aa';
// The well-known PUBLIC local-demo anon key: role=anon, no `sub`.
const ANON_KEY_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
_setTokenVerifierForTests(() => Promise.resolve({ ok: true, userId: TEST_USER_ID }));
_setQuotaRpcForTests(() => Promise.resolve({ data: true, error: null }));
function handler(req: Request): Promise<Response> {
  if (req.headers.has('Authorization')) return rawHandler(req);
  const headers = new Headers(req.headers);
  headers.set('Authorization', 'Bearer test-user-token');
  return rawHandler(new Request(req, { headers }));
}

function mockGoogle(response: { status?: number; body?: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(response.body ?? {}), {
        status: response.status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

process.env.GOOGLE_MAPS_SERVER_KEY = 'test-key';

test('?ping returns ok', async () => {
  const res = await handler(new Request('http://localhost/?ping=1'));
  assertEquals(res.status, 200);
});

test('invalid input returns 400', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origins: [], destinations: [{ lat: 0, lng: 0 }], mode: 'driving' }),
    }),
  );
  assertEquals(res.status, 400);
});

test('happy path: field mask + waypoint shape + duration parsing', async () => {
  const mock = mockGoogle({
    body: [
      { originIndex: 0, destinationIndex: 0, duration: '0s', distanceMeters: 0, condition: 'ROUTE_EXISTS' },
      { originIndex: 0, destinationIndex: 1, duration: '300s', distanceMeters: 5000, condition: 'ROUTE_EXISTS' },
      { originIndex: 1, destinationIndex: 0, duration: '350s', distanceMeters: 5000, condition: 'ROUTE_EXISTS' },
      { originIndex: 1, destinationIndex: 1, duration: '0s', distanceMeters: 0, condition: 'ROUTE_EXISTS' },
    ],
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origins: [{ lat: 38.7, lng: -9.1 }, { lat: 38.71, lng: -9.12 }],
          destinations: [{ lat: 38.7, lng: -9.1 }, { lat: 38.71, lng: -9.12 }],
          mode: 'driving',
        }),
      }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { legs: Array<{ durationSeconds: number; distanceMeters: number }> };
    assertEquals(body.legs.length, 4);
    assertEquals(body.legs[1]?.durationSeconds, 300);

    const call = mock.calls[0]!;
    const headers = new Headers(call.init.headers);
    assertStringIncludes(headers.get('X-Goog-FieldMask') ?? '', 'duration');
    assertStringIncludes(headers.get('X-Goog-FieldMask') ?? '', 'distanceMeters');

    const sent = JSON.parse(call.init.body as string) as {
      origins: Array<{ waypoint: { location: { latLng: { latitude: number; longitude: number } } } }>;
      travelMode: string;
    };
    assertEquals(sent.travelMode, 'DRIVE');
    assert(sent.origins[0]?.waypoint?.location?.latLng);
  } finally {
    mock.restore();
  }
});

test('audit #2: public anon key alone -> 401, no upstream call', async () => {
  const mock = mockGoogle({ body: [] });
  try {
    const res = await rawHandler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${ANON_KEY_JWT}` },
        body: JSON.stringify({
          origins: [{ lat: 38.7, lng: -9.1 }],
          destinations: [{ lat: 38.71, lng: -9.12 }],
          mode: 'driving',
        }),
      }),
    );
    assertEquals(res.status, 401);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test('audit #2: meters origins x destinations elements; spent quota -> 429', async () => {
  const seen: unknown[] = [];
  _setQuotaRpcForTests((args) => {
    seen.push(args);
    return Promise.resolve({ data: false, error: null });
  });
  const mock = mockGoogle({ body: [] });
  try {
    const three = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 3 }];
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ origins: three, destinations: three.slice(0, 2), mode: 'walking' }),
      }),
    );
    assertEquals(res.status, 429);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'quota_exceeded');
    assertEquals(seen, [
      { p_user: TEST_USER_ID, p_kind: 'routing_elements', p_units: 6, p_cap: 2000 },
    ]);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
    _setQuotaRpcForTests(() => Promise.resolve({ data: true, error: null }));
  }
});

test('unreachable routes are filtered out', async () => {
  const mock = mockGoogle({
    body: [
      { originIndex: 0, destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' },
      { originIndex: 0, destinationIndex: 1, duration: '60s', distanceMeters: 500, condition: 'ROUTE_EXISTS' },
    ],
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origins: [{ lat: 0, lng: 0 }],
          destinations: [{ lat: 0, lng: 0 }, { lat: 0.01, lng: 0.01 }],
          mode: 'walking',
        }),
      }),
    );
    const body = (await res.json()) as { legs: Array<unknown> };
    assertEquals(body.legs.length, 1);
  } finally {
    mock.restore();
  }
});

// ---- gap #12: upstream 5xx → 502 (Step 5.2) ------------------------------

test('upstream 5xx becomes 502', async () => {
  const mock = mockGoogle({ status: 500, body: { error: 'internal server error' } });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origins: [{ lat: 38.7, lng: -9.1 }],
          destinations: [{ lat: 38.71, lng: -9.12 }],
          mode: 'driving',
        }),
      }),
    );
    assertEquals(res.status, 502);
  } finally {
    mock.restore();
  }
});

// ---- gap #8: CORS deny (Step 5.2) ----------------------------------------

test('CORS deny: disallowed origin is not echoed in response', async () => {
  process.env.ALLOWED_ORIGINS = 'http://localhost:8081,https://tripvisor.app';

  const res = await handler(new Request('http://localhost/?ping=1', {
    headers: { origin: 'https://evil.example' },
  }));
  assertEquals(res.status, 200);
  const acao = res.headers.get('Access-Control-Allow-Origin');
  assert(
    acao !== 'https://evil.example',
    `CORS must not echo disallowed origin; got: ${acao}`,
  );
  process.env.ALLOWED_ORIGINS = '*';
});

// ---- gap #9: timeout → 504 (Step 5.2) ------------------------------------

test('upstream timeout → 504', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });
  }) as typeof fetch;

  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origins: [{ lat: 38.7, lng: -9.1 }],
          destinations: [{ lat: 38.71, lng: -9.12 }],
          mode: 'walking',
        }),
      }),
    );
    assertEquals(res.status, 504);
  } finally {
    globalThis.fetch = original;
  }
});

// ---- M5 Y2.3: the answering backend is named (trip_legs.source) ------------

test('Y2.3: the Google path names its provider', async () => {
  const mock = mockGoogle({
    body: [{ originIndex: 0, destinationIndex: 0, duration: '0s', distanceMeters: 0, condition: 'ROUTE_EXISTS' }],
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origins: [{ lat: 38.7, lng: -9.1 }],
          destinations: [{ lat: 38.7, lng: -9.1 }],
          mode: 'walking',
        }),
      }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { legs: unknown[]; provider: string };
    assertEquals(body.provider, 'google');
    assertEquals(body.legs.length, 1);
  } finally {
    mock.restore();
  }
});

test('Y2.3: the ORS path names its provider', async () => {
  process.env.ROUTING_PROVIDER = 'ors';
  process.env.ORS_API_KEY = 'test-ors-key';
  _resetRoutingStateForTests();
  const mock = mockGoogle({ body: { durations: [[0, 120.4], [130, 0]], distances: [[0, 900], [950, 0]] } });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origins: [{ lat: 38.7, lng: -9.1 }, { lat: 38.71, lng: -9.12 }],
          destinations: [{ lat: 38.7, lng: -9.1 }, { lat: 38.71, lng: -9.12 }],
          mode: 'bicycling',
        }),
      }),
    );
    assertEquals(res.status, 200);
    assertStringIncludes(mock.calls[0]!.url, 'openrouteservice.org/v2/matrix/cycling-regular');
    const body = (await res.json()) as { legs: Array<{ durationSeconds: number }>; provider: string };
    assertEquals(body.provider, 'ors');
    assertEquals(body.legs.length, 4);
    assertEquals(body.legs[1]?.durationSeconds, 120);
  } finally {
    mock.restore();
    delete process.env.ROUTING_PROVIDER;
    delete process.env.ORS_API_KEY;
    _resetRoutingStateForTests();
  }
});
