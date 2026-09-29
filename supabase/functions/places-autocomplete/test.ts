// Run with: deno test --allow-env --allow-net supabase/functions/places-autocomplete/test.ts
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import process from 'node:process';
import { test } from 'node:test';
import { handler as rawHandler } from './index.ts';
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

process.env.GOOGLE_MAPS_SERVER_KEY = 'test-key';

test('?ping returns ok', async () => {
  const res = await handler(new Request('http://localhost/?ping=1'));
  assertEquals(res.status, 200);
  const body = (await res.json()) as { ok: boolean; fn: string };
  assert(body.ok);
  assertEquals(body.fn, 'places-autocomplete');
});

test('GET is rejected (405)', async () => {
  const res = await handler(new Request('http://localhost/'));
  assertEquals(res.status, 405);
});

test('invalid JSON returns 400', async () => {
  const res = await handler(
    new Request('http://localhost/', { method: 'POST', body: '{' }),
  );
  assertEquals(res.status, 400);
});

test('missing sessionToken returns 400', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'Lisbon' }),
    }),
  );
  assertEquals(res.status, 400);
});

test('forwards session token and sends X-Goog-FieldMask', async () => {
  const mock = mockGoogle({
    body: {
      suggestions: [
        {
          placePrediction: {
            placeId: 'abc',
            structuredFormat: {
              mainText: { text: 'Lisbon' },
              secondaryText: { text: 'Portugal' },
            },
          },
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
          input: 'Lis',
          sessionToken: '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { suggestions: Array<{ placeId: string; mainText: string }> };
    assertEquals(body.suggestions.length, 1);
    assertEquals(body.suggestions[0]?.placeId, 'abc');
    assertEquals(body.suggestions[0]?.mainText, 'Lisbon');

    assertEquals(mock.calls.length, 1);
    const call = mock.calls[0]!;
    const headers = new Headers(call.init.headers);
    assert(headers.has('X-Goog-FieldMask'), 'field mask header must be present');
    assertStringIncludes(
      headers.get('X-Goog-FieldMask') ?? '',
      'suggestions.placePrediction.placeId',
    );
    assertEquals(headers.get('X-Goog-Api-Key'), 'test-key');

    const forwarded = JSON.parse(call.init.body as string) as {
      input: string;
      sessionToken: string;
    };
    assertEquals(forwarded.input, 'Lis');
    assertEquals(forwarded.sessionToken, '11111111-1111-4111-8111-111111111111');
  } finally {
    mock.restore();
  }
});

test('audit #2: public anon key alone -> 401, Google never called', async () => {
  const mock = mockGoogle({ body: { suggestions: [] } });
  try {
    for (const auth of [undefined, `Bearer ${ANON_KEY_JWT}`]) {
      const res = await rawHandler(
        new Request('http://localhost/', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(auth ? { Authorization: auth } : {}),
          },
          body: JSON.stringify({
            input: 'Lis',
            sessionToken: '11111111-1111-4111-8111-111111111111',
          }),
        }),
      );
      assertEquals(res.status, 401);
      const body = (await res.json()) as { error: { code: string } };
      assertEquals(body.error.code, 'not_authenticated');
    }
    assertEquals(mock.calls.length, 0, 'no billed Google call for unauthenticated callers');
  } finally {
    mock.restore();
  }
});

test('audit #2: daily quota spent -> 429 quota_exceeded, Google never called', async () => {
  const seen: Array<{ p_user: string; p_kind: string; p_units: number }> = [];
  _setQuotaRpcForTests((args) => {
    seen.push(args);
    return Promise.resolve({ data: false, error: null });
  });
  const mock = mockGoogle({ body: { suggestions: [] } });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: 'Lis',
          sessionToken: '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );
    assertEquals(res.status, 429);
    assert(res.headers.get('Retry-After'), 'Retry-After must be set');
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'quota_exceeded');
    assertEquals(mock.calls.length, 0);
    assertEquals(seen[0]?.p_user, TEST_USER_ID);
    assertEquals(seen[0]?.p_kind, 'places_autocomplete');
    assertEquals(seen[0]?.p_units, 1);
  } finally {
    mock.restore();
    _setQuotaRpcForTests(() => Promise.resolve({ data: true, error: null }));
  }
});

test('upstream 5xx becomes 502', async () => {
  const mock = mockGoogle({ status: 500, body: { error: 'boom' } });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: 'Paris',
          sessionToken: '22222222-2222-4222-8222-222222222222',
        }),
      }),
    );
    assertEquals(res.status, 502);
  } finally {
    mock.restore();
  }
});

// ---- gap #8: CORS deny (Step 5.2) ----------------------------------------
// Phase 1 Problem 1 fix: _shared/cors.ts fails closed when ALLOWED_ORIGINS
// does not include the caller's origin. Regression guard.

test('CORS deny: disallowed origin is not echoed in response', async () => {
  // Set ALLOWED_ORIGINS to a specific allow-list that does NOT include evil.example
  process.env.ALLOWED_ORIGINS = 'http://localhost:8081,https://tripvisor.app';

  const res = await handler(new Request('http://localhost/?ping=1', {
    headers: { origin: 'https://evil.example' },
  }));
  assertEquals(res.status, 200);
  // The Access-Control-Allow-Origin header must NOT echo the disallowed origin
  const acao = res.headers.get('Access-Control-Allow-Origin');
  assert(
    acao !== 'https://evil.example',
    `CORS must not echo disallowed origin; got: ${acao}`,
  );
  // Reset to wildcard for subsequent tests
  process.env.ALLOWED_ORIGINS = '*';
});

// ---- gap #9: timeout → 504 (Step 5.2) ------------------------------------

test('upstream timeout → 504', async () => {
  const original = globalThis.fetch;
  // Never-resolving fetch stub simulates upstream timeout
  globalThis.fetch = ((_url: string, init: RequestInit) => {
    // Honour the AbortController so the handler can abort cleanly
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'));
      });
    });
  }) as typeof fetch;

  try {
    // FETCH_TIMEOUT_MS for places-autocomplete is 3000ms; we can't override it
    // in the handler, but we can trigger abort by having the signal fire.
    // The test stubs fetch so that it rejects on abort signal — the handler's
    // fetchWithTimeout will fire the AbortController after TIMEOUT_MS.
    // To keep the test fast, we directly trigger abort on the stub above.
    // The test will naturally complete when the handler returns 504.
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          input: 'Rome',
          sessionToken: '33333333-3333-4333-8333-333333333333',
        }),
      }),
    );
    // Handler must return 504 for AbortError
    assertEquals(res.status, 504);
  } finally {
    globalThis.fetch = original;
  }
});
