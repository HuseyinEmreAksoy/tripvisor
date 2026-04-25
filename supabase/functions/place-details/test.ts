// Run with: deno test --allow-env --allow-net supabase/functions/place-details/test.ts
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';
import { assertNotMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';

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
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

Deno.env.set('GOOGLE_MAPS_SERVER_KEY', 'test-key');

Deno.test('?ping returns ok', async () => {
  const res = await handler(new Request('http://localhost/?ping=1'));
  assertEquals(res.status, 200);
  const body = (await res.json()) as { ok: boolean };
  assert(body.ok);
});

Deno.test('missing placeId returns 400', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
  );
  assertEquals(res.status, 400);
});

Deno.test('happy path: field mask + session token propagate', async () => {
  const mock = mockGoogle({
    body: {
      id: 'pid-1',
      displayName: { text: 'Belem Tower' },
      formattedAddress: 'Lisbon',
      location: { latitude: 38.7, longitude: -9.2 },
      types: ['tourist_attraction'],
      rating: 4.6,
      userRatingCount: 42000,
      reviews: [
        {
          name: 'rev1',
          rating: 5,
          text: { text: 'Beautiful', languageCode: 'en' },
          authorAttribution: { displayName: 'Jane Doe' },
          publishTime: '2025-01-01T00:00:00Z',
          relativePublishTimeDescription: 'a year ago',
        },
      ],
      photos: [
        {
          name: 'places/pid-1/photos/abc',
          widthPx: 1000,
          heightPx: 800,
          authorAttributions: [{ displayName: 'John Photographer' }],
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
          placeId: 'pid-1',
          sessionToken: '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      place: {
        placeId: string;
        displayName: string;
        reviews: Array<{ authorAttribution: { displayName: string } }>;
        photos: Array<{ attributions: Array<{ displayName: string }> }>;
      };
    };
    assertEquals(body.place.placeId, 'pid-1');
    assertEquals(body.place.displayName, 'Belem Tower');
    assertEquals(body.place.reviews[0]?.authorAttribution.displayName, 'Jane Doe');
    assertEquals(body.place.photos[0]?.attributions[0]?.displayName, 'John Photographer');

    const call = mock.calls[0]!;
    const headers = new Headers(call.init.headers);
    assertStringIncludes(headers.get('X-Goog-FieldMask') ?? '', 'reviews');
    assertStringIncludes(headers.get('X-Goog-FieldMask') ?? '', 'photos');
    assertStringIncludes(call.url, 'places/pid-1');
    assertStringIncludes(call.url, 'sessionToken=11111111-1111-4111-8111-111111111111');
  } finally {
    mock.restore();
  }
});

Deno.test('lean field mask respects caller request', async () => {
  const mock = mockGoogle({
    body: { id: 'pid-2', displayName: { text: 'Sintra' } },
  });
  try {
    await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          placeId: 'pid-2',
          fields: ['id', 'displayName'],
        }),
      }),
    );
    const call = mock.calls[0]!;
    const mask = new Headers(call.init.headers).get('X-Goog-FieldMask') ?? '';
    assertEquals(mask, 'id,displayName');
  } finally {
    mock.restore();
  }
});

Deno.test('bogus field is rejected from the mask', async () => {
  const mock = mockGoogle({
    body: { id: 'pid-3', displayName: { text: 'X' } },
  });
  try {
    await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          placeId: 'pid-3',
          fields: ['id', 'notARealField'],
        }),
      }),
    );
    const call = mock.calls[0]!;
    const mask = new Headers(call.init.headers).get('X-Goog-FieldMask') ?? '';
    assertEquals(mask, 'id');
  } finally {
    mock.restore();
  }
});

// ---- gap #17: over-broad mask negative assertions (Step 5.2) -------------
// The default field mask must NOT include fields that trigger billing-intensive
// Google SKUs or that our ToS constraints forbid persisting server-side.

Deno.test('default field mask does NOT include forbidden over-broad fields', async () => {
  const mock = mockGoogle({ body: { id: 'pid-mask', displayName: { text: 'X' } } });
  try {
    await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ placeId: 'pid-mask' }),
      }),
    );
    const call = mock.calls[0]!;
    const mask = new Headers(call.init.headers).get('X-Goog-FieldMask') ?? '';

    // These fields are NOT in our allowed set and must never appear in an
    // outgoing mask (positive assertions exist in `happy path` test above).
    const forbidden = [
      'primaryTypeDisplayName',
      'editorialSummary',
      // The following are in our allowed set (intentional); they appear in the
      // default mask. We confirm the forbidden-only fields above are absent.
    ];
    for (const field of forbidden) {
      assertNotMatch(
        mask,
        new RegExp(field),
        `Default mask must NOT include forbidden field: ${field}`,
      );
    }
  } finally {
    mock.restore();
  }
});

// ---- gap #12: upstream 5xx → error response (Step 5.2) ------------------
// place-details passes through the upstream HTTP status for non-404 errors
// (places-autocomplete always maps to 502; place-details uses the upstream
// status directly for fidelity). This test asserts a 5xx upstream results
// in a non-200 response with an upstream_error code.

Deno.test('upstream 5xx yields a non-2xx error response', async () => {
  const mock = mockGoogle({ status: 500, body: { error: 'internal server error' } });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ placeId: 'pid-5xx' }),
      }),
    );
    // The handler forwards the upstream status for non-404 errors
    assert(res.status >= 500 && res.status < 600, `Expected 5xx, got ${res.status}`);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'upstream_error');
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
        body: JSON.stringify({ placeId: 'pid-timeout' }),
      }),
    );
    assertEquals(res.status, 504);
  } finally {
    globalThis.fetch = original;
  }
});
