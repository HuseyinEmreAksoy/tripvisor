// _shared/ai.ts: quota ledger helper tests (migration 0031, audit #8).
//
// Run with:
//   deno test --allow-env --allow-net supabase/functions/_shared/ai.test.ts
//
// The helpers only touch `admin.rpc`, so a tiny fake client stands in for
// supabase-js. No network is needed beyond the std/esm module fetch.

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { consumeAiQuota, groundPlaceName, incrementAiUsage, refundAiQuota } from './ai.ts';

const D = Deno;
const USER = '11111111-1111-4111-8111-000000000001';

/** The helpers' client parameter type (derived, avoiding a second URL import). */
type SupabaseClient = Parameters<typeof consumeAiQuota>[0];
type RpcResult = { data: unknown; error: { message: string } | null };

function fakeAdmin(impl: (fn: string, args: Record<string, unknown>) => RpcResult | Promise<RpcResult>) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return await impl(fn, args);
    },
  };
  return { admin: client as unknown as SupabaseClient, calls };
}

D.test('consumeAiQuota: true -> reserved, with the exact 0031 RPC contract', async () => {
  const { admin, calls } = fakeAdmin(() => ({ data: true, error: null }));
  const out = await consumeAiQuota(
    admin,
    USER,
    { runs: 1, grounding: 0, runCap: 10, groundingCap: null },
    'req',
    'test',
  );
  assertEquals(out, 'reserved');
  assertEquals(calls, [
    {
      fn: 'consume_ai_quota',
      args: { p_user: USER, p_runs: 1, p_grounding: 0, p_run_cap: 10, p_grounding_cap: null },
    },
  ]);
});

D.test('consumeAiQuota: false or null -> blocked', async () => {
  for (const data of [false, null]) {
    const { admin } = fakeAdmin(() => ({ data, error: null }));
    const out = await consumeAiQuota(
      admin,
      USER,
      { runs: 0, grounding: 5, runCap: null, groundingCap: 100 },
      'req',
      'test',
    );
    assertEquals(out, 'blocked');
  }
});

D.test('consumeAiQuota: RPC error or thrown transport error -> error (callers fail closed)', async () => {
  const errored = fakeAdmin(() => ({ data: null, error: { message: 'Could not find the function' } }));
  assertEquals(
    await consumeAiQuota(errored.admin, USER, { runs: 1, grounding: 0, runCap: 10, groundingCap: null }, 'r', 't'),
    'error',
  );
  const thrown = fakeAdmin(() => {
    throw new TypeError('network down');
  });
  assertEquals(
    await consumeAiQuota(thrown.admin, USER, { runs: 1, grounding: 0, runCap: 10, groundingCap: null }, 'r', 't'),
    'error',
  );
});

D.test('refundAiQuota: skips zero/negative amounts (never sends a negative refund)', async () => {
  const { admin, calls } = fakeAdmin(() => ({ data: null, error: null }));
  await refundAiQuota(admin, USER, { runs: 0, grounding: 0, day: '2026-09-29' }, 'r', 't');
  await refundAiQuota(admin, USER, { runs: -3, grounding: -1, day: '2026-09-29' }, 'r', 't');
  assertEquals(calls.length, 0);
});

D.test('refundAiQuota: sends the unused amount pinned to the reservation day', async () => {
  const { admin, calls } = fakeAdmin(() => ({ data: null, error: null }));
  await refundAiQuota(admin, USER, { runs: 0, grounding: 2, day: '2026-09-29' }, 'r', 't');
  assertEquals(calls, [
    { fn: 'refund_ai_quota', args: { p_user: USER, p_runs: 0, p_grounding: 2, p_day: '2026-09-29' } },
  ]);
});

D.test('refundAiQuota: never throws on RPC error or transport failure', async () => {
  const errored = fakeAdmin(() => ({ data: null, error: { message: 'boom' } }));
  await refundAiQuota(errored.admin, USER, { runs: 1, grounding: 0, day: '2026-09-29' }, 'r', 't');
  const thrown = fakeAdmin(() => {
    throw new Error('network');
  });
  await refundAiQuota(thrown.admin, USER, { runs: 1, grounding: 0, day: '2026-09-29' }, 'r', 't');
});

D.test('incrementAiUsage: zero spend skips the RPC round trip; real spend is recorded', async () => {
  const { admin, calls } = fakeAdmin(() => ({ data: null, error: null }));
  await incrementAiUsage(admin, USER, 0, 0, 'r', 't');
  assertEquals(calls.length, 0);
  await incrementAiUsage(admin, USER, 0, 3, 'r', 't');
  assertEquals(calls, [
    { fn: 'increment_ai_usage', args: { p_user_id: USER, p_runs: 0, p_grounding: 3, p_routing: 0 } },
  ]);
});

// ----- groundPlaceName: app language reaches Google (M5 F10 #3) -------------

async function withFakePlaces(
  run: (calls: Array<{ url: string; body: unknown }>) => Promise<void>,
): Promise<void> {
  const calls: Array<{ url: string; body: unknown }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = url.includes(':autocomplete')
      ? { suggestions: [{ placePrediction: { placeId: 'pid1' } }] }
      : { id: 'pid1', location: { latitude: 41, longitude: 29 }, displayName: { text: 'Ayasofya' } };
    return Promise.resolve(new Response(JSON.stringify(json), { status: 200 }));
  }) as typeof fetch;
  try {
    await run(calls);
  } finally {
    globalThis.fetch = realFetch;
  }
}

D.test('groundPlaceName: lang is sent as languageCode on autocomplete AND details', async () => {
  await withFakePlaces(async (calls) => {
    const out = await groundPlaceName('Hagia Sophia', { destination: 'Istanbul', lang: 'tr' }, 'k', 'req', 'test');
    assertEquals(out.kind, 'resolved');
    if (out.kind === 'resolved') assertEquals(out.canonicalName, 'Ayasofya');
    assertEquals((calls[0]!.body as Record<string, unknown>).languageCode, 'tr');
    assertEquals(new URL(calls[1]!.url).searchParams.get('languageCode'), 'tr');
  });
});

D.test('groundPlaceName: no lang -> no languageCode (Google default)', async () => {
  await withFakePlaces(async (calls) => {
    await groundPlaceName('Louvre', { destination: 'Paris' }, 'k', 'req', 'test');
    assertEquals('languageCode' in (calls[0]!.body as Record<string, unknown>), false);
    assertEquals(new URL(calls[1]!.url).searchParams.has('languageCode'), false);
  });
});
