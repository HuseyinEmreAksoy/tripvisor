// Run: deno test --allow-env --allow-net supabase/functions/distance-matrix/test.ts
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

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

Deno.env.set('GOOGLE_MAPS_SERVER_KEY', 'test-key');

Deno.test('?ping returns ok', async () => {
  const res = await handler(new Request('http://localhost/?ping=1'));
  assertEquals(res.status, 200);
});

Deno.test('invalid input returns 400', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origins: [], destinations: [{ lat: 0, lng: 0 }], mode: 'driving' }),
    }),
  );
  assertEquals(res.status, 400);
});

Deno.test('happy path: field mask + waypoint shape + duration parsing', async () => {
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

Deno.test('unreachable routes are filtered out', async () => {
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

Deno.test('upstream 5xx becomes 502', async () => {
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

Deno.test('CORS deny: disallowed origin is not echoed in response', async () => {
  Deno.env.set('ALLOWED_ORIGINS', 'http://localhost:8081,https://tripvisor.app');

  const res = await handler(new Request('http://localhost/?ping=1', {
    headers: { origin: 'https://evil.example' },
  }));
  assertEquals(res.status, 200);
  const acao = res.headers.get('Access-Control-Allow-Origin');
  assert(
    acao !== 'https://evil.example',
    `CORS must not echo disallowed origin; got: ${acao}`,
  );
  Deno.env.set('ALLOWED_ORIGINS', '*');
});

// ---- gap #9: timeout → 504 (Step 5.2) ------------------------------------

Deno.test('upstream timeout → 504', async () => {
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
