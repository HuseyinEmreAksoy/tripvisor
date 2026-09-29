// ai-itinerary: quota-gate tests (migration 0031, audit #8: atomic AI quota).
//
// Run with:
//   deno test --allow-env --allow-net supabase/functions/ai-itinerary/index.test.ts
//
// Every Supabase / Gemini / Places call is intercepted by a globalThis.fetch
// stub (same pattern as manage-collaborators/index.test.ts). What is proven:
//   - the atomic consume_ai_quota reservation happens BEFORE any LLM spend,
//   - blocked -> the existing 429 quota_exceeded (LLM never called),
//   - RPC failure -> fail CLOSED 500 db_error (LLM never called),
//   - the run is not double-counted (post-hoc increment carries runs = 0),
//   - a failed LLM run keeps its reservation (no refund, no extra increment),
//   - the 200 response shape is unchanged.

import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

const D = Deno;

D.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
D.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
D.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
D.env.set('GEMINI_API_KEY', 'test-gemini');
D.env.set('GOOGLE_MAPS_SERVER_KEY', 'test-google');
D.env.delete('GROQ_API_KEY');

const USER_ID = '11111111-1111-4111-8111-000000000001';
const JWT = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.USER.SIG';
const RUN_ID = '99999999-9999-4999-8999-000000000009';

interface FetchCall {
  url: string;
  method: string;
  body: string | null;
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Scenario {
  /** Today's ai_runs seen by the early fast-fail read. */
  runsToday: number;
  /** consume_ai_quota outcome. */
  reserve: 'true' | 'false' | 'error';
  gemini: 'ok' | 'fail';
}

function stub(sc: Scenario): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method, body });

    if (url.includes('/auth/v1/user')) return jsonResp({ user: { id: USER_ID, email: 'u@test.local' } });
    if (url.includes('/rest/v1/trip_ai_runs') && method === 'GET') return jsonResp([]);
    if (url.includes('/rest/v1/trip_ai_runs') && method === 'POST') return jsonResp({ id: RUN_ID }, 201);
    if (url.includes('/rest/v1/ai_usage')) {
      return jsonResp([{ ai_runs: sc.runsToday, grounding_calls: 0 }]);
    }
    if (url.includes('/rest/v1/rpc/consume_ai_quota')) {
      if (sc.reserve === 'error') {
        return jsonResp({ code: 'PGRST202', message: 'Could not find the function' }, 404);
      }
      return jsonResp(sc.reserve === 'true');
    }
    if (url.includes('/rest/v1/rpc/increment_ai_usage')) return jsonResp(null, 204);
    if (url.includes('generativelanguage.googleapis.com')) {
      if (sc.gemini === 'fail') return jsonResp({ error: 'overloaded' }, 503);
      const text = JSON.stringify({
        days: [{ dayHint: 1, places: [{ name: 'Louvre', category: 'museum', visitMinutes: 120 }] }],
        notes: null,
      });
      return jsonResp({
        candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
      });
    }
    if (url.includes('places:autocomplete')) {
      return jsonResp({ suggestions: [{ placePrediction: { placeId: 'ChIJLouvre' } }] });
    }
    if (url.includes('places.googleapis.com/v1/places/')) {
      return jsonResp({
        id: 'ChIJLouvre',
        location: { latitude: 48.86, longitude: 2.33 },
        displayName: { text: 'Musée du Louvre' },
      });
    }
    return jsonResp({ error: `unexpected ${method} ${url}` }, 500);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function planRequest(): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: JWT },
    body: JSON.stringify({
      prompt: 'Two relaxed days of museums in Paris',
      days: 1,
      destination: 'Paris',
      idempotencyKey: 'idem-key-0001',
    }),
  });
}

const isConsume = (c: FetchCall) => c.url.includes('/rpc/consume_ai_quota');
const isGemini = (c: FetchCall) => c.url.includes('generativelanguage.googleapis.com');
const isIncrement = (c: FetchCall) => c.url.includes('/rpc/increment_ai_usage');
const isGoogle = (c: FetchCall) => c.url.includes('places.googleapis.com');

D.test('audit #8: reservation happens BEFORE the LLM call; run is not double-counted', async () => {
  const mock = stub({ runsToday: 3, reserve: 'true', gemini: 'ok' });
  try {
    const res = await handler(planRequest());
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      runId: string;
      status: string;
      draft: { places: unknown[]; unresolved: string[]; notes: unknown; dayCount: number };
      usage: { runsToday: number; dailyLimit: number };
    };
    // Response contract unchanged.
    assertEquals(Object.keys(body).sort(), ['draft', 'runId', 'status', 'usage']);
    assertEquals(body.runId, RUN_ID);
    assertEquals(body.status, 'ok');
    assertEquals(body.draft.places.length, 1);
    assertEquals(body.usage, { runsToday: 4, dailyLimit: 10 });

    const consumeIdx = mock.calls.findIndex(isConsume);
    const geminiIdx = mock.calls.findIndex(isGemini);
    assert(consumeIdx >= 0, 'consume_ai_quota was not called');
    assert(consumeIdx < geminiIdx, 'the reservation must precede the LLM call');
    assertEquals(JSON.parse(mock.calls[consumeIdx]!.body!), {
      p_user: USER_ID,
      p_runs: 1,
      p_grounding: 0,
      p_run_cap: 10,
      p_grounding_cap: null,
    });

    // Post-hoc ledger write records ONLY the grounding details call (runs = 0).
    const incs = mock.calls.filter(isIncrement).map((c) => JSON.parse(c.body!));
    assertEquals(incs, [{ p_user_id: USER_ID, p_runs: 0, p_grounding: 1, p_routing: 0 }]);
  } finally {
    mock.restore();
  }
});

D.test('audit #8: blocked reservation -> 429 quota_exceeded and NO LLM/Google spend', async () => {
  // The early read says 9/10 (passes), but a concurrent request won the last slot.
  const mock = stub({ runsToday: 9, reserve: 'false', gemini: 'ok' });
  try {
    const res = await handler(planRequest());
    assertEquals(res.status, 429);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assertEquals(body.error.code, 'quota_exceeded');
    assertEquals(mock.calls.filter(isGemini).length, 0);
    assertEquals(mock.calls.filter(isGoogle).length, 0);
    assertEquals(mock.calls.filter(isIncrement).length, 0);
  } finally {
    mock.restore();
  }
});

D.test('audit #8: reservation RPC failure fails CLOSED -> 500 db_error, no spend', async () => {
  const mock = stub({ runsToday: 0, reserve: 'error', gemini: 'ok' });
  try {
    const res = await handler(planRequest());
    assertEquals(res.status, 500);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'db_error');
    assertEquals(mock.calls.filter(isGemini).length, 0);
  } finally {
    mock.restore();
  }
});

D.test('audit #8: early read at the cap -> 429 without even reserving', async () => {
  const mock = stub({ runsToday: 10, reserve: 'true', gemini: 'ok' });
  try {
    const res = await handler(planRequest());
    assertEquals(res.status, 429);
    assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'quota_exceeded');
    assertEquals(mock.calls.filter(isConsume).length, 0);
    assertEquals(mock.calls.filter(isGemini).length, 0);
  } finally {
    mock.restore();
  }
});

D.test('audit #8: LLM failure keeps the reservation (no refund, no second increment) -> 502', async () => {
  const mock = stub({ runsToday: 2, reserve: 'true', gemini: 'fail' });
  try {
    const res = await handler(planRequest());
    assertEquals(res.status, 502);
    assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'llm_failed');
    assertEquals(mock.calls.filter(isConsume).length, 1);
    assertEquals(mock.calls.filter(isIncrement).length, 0);
    assertEquals(mock.calls.filter((c) => c.url.includes('/rpc/refund_ai_quota')).length, 0);
  } finally {
    mock.restore();
  }
});
