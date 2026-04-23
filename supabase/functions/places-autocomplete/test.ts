// Run with: deno test --allow-env --allow-net supabase/functions/places-autocomplete/test.ts
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
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
  const body = (await res.json()) as { ok: boolean; fn: string };
  assert(body.ok);
  assertEquals(body.fn, 'places-autocomplete');
});

Deno.test('GET is rejected (405)', async () => {
  const res = await handler(new Request('http://localhost/'));
  assertEquals(res.status, 405);
});

Deno.test('invalid JSON returns 400', async () => {
  const res = await handler(
    new Request('http://localhost/', { method: 'POST', body: '{' }),
  );
  assertEquals(res.status, 400);
});

Deno.test('missing sessionToken returns 400', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'Lisbon' }),
    }),
  );
  assertEquals(res.status, 400);
});

Deno.test('forwards session token and sends X-Goog-FieldMask', async () => {
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

Deno.test('upstream 5xx becomes 502', async () => {
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
