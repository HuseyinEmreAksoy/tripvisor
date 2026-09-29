// ai-edit: quota-gate tests (migration 0031, audit #8: atomic AI quota).
//
// Run with:
//   deno test --allow-env --allow-net supabase/functions/ai-edit/index.test.ts
//
// All Supabase / Gemini / Places traffic is intercepted by a globalThis.fetch
// stub. What is proven:
//   - edit: the run reservation precedes the LLM call; blocked -> 429 with no
//     spend; RPC failure -> fail-closed 500 db_error.
//   - ground: one grounding call per name is reserved atomically against the
//     100/day budget BEFORE any Google call. The unused part (names that never
//     reached a details call) is refunded, pinned to the reservation day, so
//     the ledger still equals actual details spend (no separate increment).

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
const TRIP_ID = '33333333-3333-4333-8333-000000000003';
const PLACE_ID = '44444444-4444-4444-8444-000000000004';
const RUN_ID = '99999999-9999-4999-8999-000000000009';
const JWT = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.USER.SIG';

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
  runsToday: number;
  groundingToday: number;
  reserve: 'true' | 'false' | 'error';
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
      return jsonResp([{ ai_runs: sc.runsToday, grounding_calls: sc.groundingToday }]);
    }
    if (url.includes('/rest/v1/trips')) return jsonResp([{ id: TRIP_ID, title: 'Paris' }]);
    if (url.includes('/rest/v1/trip_places')) {
      return jsonResp([
        {
          id: PLACE_ID,
          user_title: 'Louvre',
          google_place_id: 'ChIJLouvre',
          day_index: 0,
          visit_duration_minutes: 120,
          lat: 48.86,
          lng: 2.33,
        },
      ]);
    }
    if (url.includes('/rest/v1/rpc/consume_ai_quota')) {
      if (sc.reserve === 'error') {
        return jsonResp({ code: 'PGRST202', message: 'Could not find the function' }, 404);
      }
      return jsonResp(sc.reserve === 'true');
    }
    if (url.includes('/rest/v1/rpc/refund_ai_quota')) return jsonResp(null, 204);
    if (url.includes('/rest/v1/rpc/increment_ai_usage')) return jsonResp(null, 204);
    if (url.includes('generativelanguage.googleapis.com')) {
      const text = JSON.stringify({
        adds: [],
        removes: [],
        moves: [],
        durationChanges: [{ id: 'p1', visitMinutes: 90 }],
        notes: null,
      });
      return jsonResp({ candidates: [{ content: { parts: [{ text }] } }] });
    }
    if (url.includes('places:autocomplete')) {
      const input = JSON.parse(body ?? '{}').input as string;
      // "Nowhere" never matches: 0 details calls for that name, so it gets refunded.
      if (input.startsWith('Nowhere')) return jsonResp({ suggestions: [] });
      const id = input.startsWith('Eiffel') ? 'ChIJEiffel' : 'ChIJLouvre';
      return jsonResp({ suggestions: [{ placePrediction: { placeId: id } }] });
    }
    if (url.includes('places.googleapis.com/v1/places/')) {
      const id = url.includes('ChIJEiffel') ? 'ChIJEiffel' : 'ChIJLouvre';
      return jsonResp({ id, location: { latitude: 48.85, longitude: 2.29 }, displayName: { text: id } });
    }
    return jsonResp({ error: `unexpected ${method} ${url}` }, 500);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function post(body: unknown): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: JWT },
    body: JSON.stringify(body),
  });
}

const editBody = () => ({
  action: 'edit',
  tripId: TRIP_ID,
  instruction: 'Shorten the Louvre visit a bit',
  idempotencyKey: 'idem-edit-0001',
});
const groundBody = () => ({
  action: 'ground',
  names: ['Louvre', 'Nowhere Place', 'Eiffel Tower'],
  destination: 'Paris',
  idempotencyKey: 'idem-ground-0001',
});

const byRpc = (calls: FetchCall[], name: string) =>
  calls.filter((c) => c.url.includes(`/rpc/${name}`)).map((c) => JSON.parse(c.body!));
const isGemini = (c: FetchCall) => c.url.includes('generativelanguage.googleapis.com');
const isGoogle = (c: FetchCall) => c.url.includes('places.googleapis.com');

// ---- edit ---------------------------------------------------------------------

D.test('audit #8 edit: run reserved BEFORE the LLM; not double-counted; 200 shape unchanged', async () => {
  const mock = stub({ runsToday: 1, groundingToday: 0, reserve: 'true' });
  try {
    const res = await handler(post(editBody()));
    assertEquals(res.status, 200);
    const body = (await res.json()) as Record<string, unknown> & { usage: unknown };
    assertEquals(Object.keys(body).sort(), ['diff', 'runId', 'status', 'unresolved', 'usage']);
    assertEquals(body.usage, { runsToday: 2, dailyLimit: 10 });

    const consumeIdx = mock.calls.findIndex((c) => c.url.includes('/rpc/consume_ai_quota'));
    const geminiIdx = mock.calls.findIndex(isGemini);
    assert(consumeIdx >= 0 && consumeIdx < geminiIdx, 'reservation must precede the LLM call');
    assertEquals(byRpc(mock.calls, 'consume_ai_quota'), [
      { p_user: USER_ID, p_runs: 1, p_grounding: 0, p_run_cap: 10, p_grounding_cap: null },
    ]);
    // No adds -> no grounding -> nothing post-hoc to record (and never runs = 1 again).
    assertEquals(byRpc(mock.calls, 'increment_ai_usage'), []);
  } finally {
    mock.restore();
  }
});

D.test('audit #8 edit: blocked reservation -> 429 quota_exceeded, LLM never called', async () => {
  const mock = stub({ runsToday: 9, groundingToday: 0, reserve: 'false' });
  try {
    const res = await handler(post(editBody()));
    assertEquals(res.status, 429);
    assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'quota_exceeded');
    assertEquals(mock.calls.filter(isGemini).length, 0);
  } finally {
    mock.restore();
  }
});

D.test('audit #8 edit: reservation RPC failure fails CLOSED -> 500 db_error', async () => {
  const mock = stub({ runsToday: 0, groundingToday: 0, reserve: 'error' });
  try {
    const res = await handler(post(editBody()));
    assertEquals(res.status, 500);
    assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'db_error');
    assertEquals(mock.calls.filter(isGemini).length, 0);
  } finally {
    mock.restore();
  }
});

// ---- ground -------------------------------------------------------------------

D.test('audit #8 ground: reserve per name before Google, refund the unused part (day-pinned)', async () => {
  const mock = stub({ runsToday: 0, groundingToday: 40, reserve: 'true' });
  try {
    const day = new Date().toISOString().slice(0, 10);
    const res = await handler(post(groundBody()));
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      resolved: unknown[];
      unresolved: string[];
      usage: { groundingToday: number; dailyLimit: number };
    };
    assertEquals(body.resolved.length, 2);
    assertEquals(body.unresolved, ['Nowhere Place']);
    assertEquals(body.usage, { groundingToday: 42, dailyLimit: 100 });

    const consumeIdx = mock.calls.findIndex((c) => c.url.includes('/rpc/consume_ai_quota'));
    const firstGoogle = mock.calls.findIndex(isGoogle);
    assert(consumeIdx >= 0 && consumeIdx < firstGoogle, 'reservation must precede any Google call');
    assertEquals(byRpc(mock.calls, 'consume_ai_quota'), [
      { p_user: USER_ID, p_runs: 0, p_grounding: 3, p_run_cap: null, p_grounding_cap: 100 },
    ]);
    // 3 reserved, 2 details calls made -> refund 1 on the reservation day.
    assertEquals(byRpc(mock.calls, 'refund_ai_quota'), [
      { p_user: USER_ID, p_runs: 0, p_grounding: 1, p_day: day },
    ]);
    // The reservation IS the ledger write for ground: no extra increment.
    assertEquals(byRpc(mock.calls, 'increment_ai_usage'), []);
  } finally {
    mock.restore();
  }
});

D.test('audit #8 ground: blocked reservation -> 429 quota_exceeded, no Google call, no refund', async () => {
  const mock = stub({ runsToday: 0, groundingToday: 90, reserve: 'false' });
  try {
    const res = await handler(post(groundBody()));
    assertEquals(res.status, 429);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assertEquals(body.error.code, 'quota_exceeded');
    assert(body.error.message.includes('/100 used today'));
    assertEquals(mock.calls.filter(isGoogle).length, 0);
    assertEquals(byRpc(mock.calls, 'refund_ai_quota'), []);
  } finally {
    mock.restore();
  }
});

D.test('audit #8 ground: reservation RPC failure fails CLOSED -> 500 db_error, no Google call', async () => {
  const mock = stub({ runsToday: 0, groundingToday: 0, reserve: 'error' });
  try {
    const res = await handler(post(groundBody()));
    assertEquals(res.status, 500);
    assertEquals(((await res.json()) as { error: { code: string } }).error.code, 'db_error');
    assertEquals(mock.calls.filter(isGoogle).length, 0);
  } finally {
    mock.restore();
  }
});
