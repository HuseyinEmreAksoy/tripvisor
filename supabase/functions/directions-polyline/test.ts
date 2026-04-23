// Run: deno test --allow-env --allow-net supabase/functions/directions-polyline/test.ts
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

Deno.test('missing fields return 400', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: { lat: 0, lng: 0 }, mode: 'driving' }),
    }),
  );
  assertEquals(res.status, 400);
});

Deno.test('happy path: returns polyline + totals; optimizeWaypointOrder false', async () => {
  const mock = mockGoogle({
    body: {
      routes: [
        {
          duration: '1800s',
          distanceMeters: 15000,
          polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC' },
        },
      ],
    },
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: 38.7, lng: -9.1 },
          destination: { lat: 38.76, lng: -9.09 },
          intermediates: [{ lat: 38.71, lng: -9.11 }],
          mode: 'driving',
        }),
      }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      polyline: string;
      durationSeconds: number;
      distanceMeters: number;
    };
    assertEquals(body.durationSeconds, 1800);
    assertEquals(body.distanceMeters, 15000);
    assert(body.polyline.length > 0);

    const call = mock.calls[0]!;
    const headers = new Headers(call.init.headers);
    assertStringIncludes(headers.get('X-Goog-FieldMask') ?? '', 'routes.polyline.encodedPolyline');

    const sent = JSON.parse(call.init.body as string) as {
      optimizeWaypointOrder: boolean;
      polylineEncoding: string;
    };
    assertEquals(sent.optimizeWaypointOrder, false);
    assertEquals(sent.polylineEncoding, 'ENCODED_POLYLINE');
  } finally {
    mock.restore();
  }
});

Deno.test('empty routes returns 404', async () => {
  const mock = mockGoogle({ body: { routes: [] } });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: 0, lng: 0 },
          destination: { lat: 1, lng: 1 },
          mode: 'driving',
        }),
      }),
    );
    assertEquals(res.status, 404);
  } finally {
    mock.restore();
  }
});

Deno.test('too many intermediates rejected', async () => {
  const intermediates = Array.from({ length: 30 }, (_, i) => ({ lat: i * 0.01, lng: i * 0.01 }));
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        origin: { lat: 0, lng: 0 },
        destination: { lat: 1, lng: 1 },
        intermediates,
        mode: 'driving',
      }),
    }),
  );
  assertEquals(res.status, 400);
});
