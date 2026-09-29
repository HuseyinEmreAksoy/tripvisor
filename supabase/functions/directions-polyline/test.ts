// Run: deno test --allow-env --allow-net supabase/functions/directions-polyline/test.ts
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import process from 'node:process';
import { test } from 'node:test';
import { handler as rawHandler, routeQuotaUnits } from './index.ts';
import { _setQuotaRpcForTests, _setTokenVerifierForTests } from '../_shared/auth.ts';

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
