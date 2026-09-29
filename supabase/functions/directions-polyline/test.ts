// Run: deno test --allow-env --allow-net supabase/functions/directions-polyline/test.ts
// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import process from 'node:process';
import { test } from 'node:test';
import {
  decodePolylineE5,
  encodePolylineE5,
  handler as rawHandler,
  routeQuotaUnits,
  splitOrsRoute,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './index.ts';
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

test('audit #2: route quota units = 1, or 2 above 10 intermediates (Pro SKU)', () => {
  assertEquals(routeQuotaUnits(0), 1);
  assertEquals(routeQuotaUnits(10), 1);
  assertEquals(routeQuotaUnits(11), 2);
  assertEquals(routeQuotaUnits(23), 2);
});

test('audit #2: public anon key alone -> 401, no upstream call', async () => {
  const mock = mockGoogle({ body: { routes: [] } });
  try {
    const res = await rawHandler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${ANON_KEY_JWT}` },
        body: JSON.stringify({
          origin: { lat: 38.7, lng: -9.1 },
          destination: { lat: 38.71, lng: -9.12 },
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

test('audit #2: spent routing quota -> 429 quota_exceeded, no upstream call', async () => {
  const seen: unknown[] = [];
  _setQuotaRpcForTests((args) => {
    seen.push(args);
    return Promise.resolve({ data: false, error: null });
  });
  const mock = mockGoogle({ body: { routes: [] } });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: 38.7, lng: -9.1 },
          destination: { lat: 38.71, lng: -9.12 },
          mode: 'driving',
        }),
      }),
    );
    assertEquals(res.status, 429);
    assertEquals(seen, [
      { p_user: TEST_USER_ID, p_kind: 'routing_elements', p_units: 1, p_cap: 2000 },
    ]);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
    _setQuotaRpcForTests(() => Promise.resolve({ data: true, error: null }));
  }
});

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

test('missing fields return 400', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ origin: { lat: 0, lng: 0 }, mode: 'driving' }),
    }),
  );
  assertEquals(res.status, 400);
});

test('happy path: returns polyline + totals; optimizeWaypointOrder false', async () => {
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

test('empty routes returns 404', async () => {
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

test('too many intermediates rejected', async () => {
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

// ---- gap #12: upstream 5xx → 502 (Step 5.2) ------------------------------

test('upstream 5xx becomes 502', async () => {
  const mock = mockGoogle({ status: 500, body: { error: 'service error' } });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: 38.7, lng: -9.1 },
          destination: { lat: 38.76, lng: -9.09 },
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
          origin: { lat: 38.7, lng: -9.1 },
          destination: { lat: 38.76, lng: -9.09 },
          mode: 'walking',
        }),
      }),
    );
    assertEquals(res.status, 504);
  } finally {
    globalThis.fetch = original;
  }
});

// ---- M5 Y2.3: provider, per-leg split, transit noRoute ----------------------

test('Y2.3 polyline5 codec: Google reference string round-trips exactly', () => {
  const ref = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
  const pts = decodePolylineE5(ref);
  assertEquals(pts, [
    [3850000, -12020000],
    [4070000, -12095000],
    [4325200, -12645300],
  ]);
  assertEquals(encodePolylineE5(pts), ref);
  let threw = false;
  try {
    decodePolylineE5('_p~iF~ps|'); // truncated mid-value
  } catch {
    threw = true;
  }
  assert(threw, 'a truncated polyline is rejected, not half-decoded');
});

test('Y2.3 Google: perLeg asks for routes.legs and returns one entry per waypoint pair', async () => {
  const mock = mockGoogle({
    body: {
      routes: [
        {
          duration: '900s',
          distanceMeters: 9000,
          polyline: { encodedPolyline: 'whole' },
          legs: [
            { duration: '300s', distanceMeters: 3000, polyline: { encodedPolyline: 'leg0' } },
            { duration: '600s', distanceMeters: 6000, polyline: { encodedPolyline: 'leg1' } },
          ],
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
          intermediates: [{ lat: 38.71, lng: -9.11 }],
          destination: { lat: 38.76, lng: -9.09 },
          mode: 'driving',
          perLeg: true,
        }),
      }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      polyline: string;
      provider: string;
      legs: Array<{ polyline: string; durationSeconds: number; distanceMeters: number }>;
    };
    assertEquals(body.provider, 'google');
    assertEquals(body.polyline, 'whole');
    assertEquals(body.legs, [
      { polyline: 'leg0', durationSeconds: 300, distanceMeters: 3000 },
      { polyline: 'leg1', durationSeconds: 600, distanceMeters: 6000 },
    ]);
    const mask = new Headers(mock.calls[0]!.init.headers).get('X-Goog-FieldMask') ?? '';
    assertStringIncludes(mask, 'routes.polyline.encodedPolyline');
    assertStringIncludes(mask, 'routes.legs.duration');
    assertStringIncludes(mask, 'routes.legs.distanceMeters');
    assertStringIncludes(mask, 'routes.legs.polyline.encodedPolyline');
  } finally {
    mock.restore();
  }
});

test('Y2.3 Google: without perLeg the mask and body stay pre-Y2.3 (plus provider)', async () => {
  const mock = mockGoogle({
    body: { routes: [{ duration: '60s', distanceMeters: 500, polyline: { encodedPolyline: 'abc' } }] },
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: 38.7, lng: -9.1 },
          intermediates: [{ lat: 38.71, lng: -9.11 }],
          destination: { lat: 38.76, lng: -9.09 },
          mode: 'walking',
        }),
      }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    assertEquals(body, { polyline: 'abc', durationSeconds: 60, distanceMeters: 500, provider: 'google' });
    assertEquals(
      new Headers(mock.calls[0]!.init.headers).get('X-Goog-FieldMask'),
      'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
    );
  } finally {
    mock.restore();
  }
});

test('Y2.3 Google: an inconsistent leg split is omitted, not guessed', async () => {
  const mock = mockGoogle({
    body: {
      routes: [
        {
          duration: '900s',
          distanceMeters: 9000,
          polyline: { encodedPolyline: 'whole' },
          legs: [{ duration: '900s', distanceMeters: 9000, polyline: { encodedPolyline: 'only-one' } }],
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
          intermediates: [{ lat: 38.71, lng: -9.11 }],
          destination: { lat: 38.76, lng: -9.09 },
          mode: 'bicycling',
          perLeg: true,
        }),
      }),
    );
    const body = (await res.json()) as Record<string, unknown>;
    assertEquals(res.status, 200);
    assertEquals('legs' in body, false);
  } finally {
    mock.restore();
  }
});

test('Y2.3 transit with no route: 200 zeros + noRoute + provider (no split for transit)', async () => {
  const mock = mockGoogle({ body: { routes: [] } });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          origin: { lat: 38.7, lng: -9.1 },
          destination: { lat: 38.76, lng: -9.09 },
          mode: 'transit',
          perLeg: true,
        }),
      }),
    );
    assertEquals(res.status, 200);
    assertEquals(await res.json(), {
      polyline: null,
      durationSeconds: 0,
      distanceMeters: 0,
      noRoute: true,
      provider: 'google',
    });
    const mask = new Headers(mock.calls[0]!.init.headers).get('X-Goog-FieldMask') ?? '';
    assert(!mask.includes('routes.legs.duration'), 'transit never asks for a leg split');
  } finally {
    mock.restore();
  }
});

test('Y2.3 ORS: perLeg splits the geometry at way_points (exact characters) + segment numbers', async () => {
  const pts: Array<[number, number]> = [
    [3870000, -910000],
    [3870500, -910700],
    [3871000, -911000],
    [3872200, -910400],
    [3876000, -909000],
  ];
  const geometry = encodePolylineE5(pts);
  process.env.ROUTING_PROVIDER = 'ors';
  process.env.ORS_API_KEY = 'test-ors-key';
  _resetRoutingStateForTests();
  const mock = mockGoogle({
    body: {
      routes: [
        {
          summary: { distance: 3000.8, duration: 301 },
          geometry,
          segments: [
            { distance: 1000.6, duration: 100.4 },
            { distance: 2000.2, duration: 200.6 },
          ],
          way_points: [0, 2, 4],
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
          intermediates: [{ lat: 38.71, lng: -9.11 }],
          destination: { lat: 38.76, lng: -9.09 },
          mode: 'walking',
          perLeg: true,
        }),
      }),
    );
    assertEquals(res.status, 200);
    assertStringIncludes(mock.calls[0]!.url, 'openrouteservice.org/v2/directions/foot-walking');
    const body = (await res.json()) as {
      provider: string;
      polyline: string;
      durationSeconds: number;
      legs: Array<{ polyline: string; durationSeconds: number; distanceMeters: number }>;
    };
    assertEquals(body.provider, 'ors');
    assertEquals(body.polyline, geometry);
    assertEquals(body.durationSeconds, 301);
    assertEquals(body.legs, [
      { polyline: encodePolylineE5(pts.slice(0, 3)), durationSeconds: 100, distanceMeters: 1001 },
      { polyline: encodePolylineE5(pts.slice(2, 5)), durationSeconds: 201, distanceMeters: 2000 },
    ]);
    assertEquals(decodePolylineE5(body.legs[1]!.polyline), pts.slice(2, 5));

    // Unsplittable ORS payload (no segments): legs omitted, route still served.
    assertEquals(
      splitOrsRoute({ geometry, way_points: [0, 2, 4] }, 3),
      undefined,
    );
    assertEquals(
      splitOrsRoute({ geometry, segments: [{}, {}], way_points: [0, 9, 4] }, 3),
      undefined,
      'way_points out of order / range are rejected',
    );
  } finally {
    mock.restore();
    delete process.env.ROUTING_PROVIDER;
    delete process.env.ORS_API_KEY;
    _resetRoutingStateForTests();
  }
});
