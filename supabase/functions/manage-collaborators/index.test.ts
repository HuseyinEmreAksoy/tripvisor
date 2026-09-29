// manage-collaborators — Deno integration tests.
//
// Run with:
//   deno test --allow-env --allow-net=127.0.0.1 supabase/functions/manage-collaborators/index.test.ts
//
// All Supabase and auth calls are intercepted via globalThis.fetch stubs.
// Auth.getUser is resolved via the anon-client fetch stub that returns a
// canned user object based on the supplied bearer token prefix.
//
// Pattern follows supabase/functions/optimize-trip/test.ts.
//
// The repo-root `npx tsc` (Expo tsconfig) also type-checks this file but
// cannot resolve Deno URL / `.ts`-suffixed imports or the `Deno` global. The
// `@ts-ignore`s below silence exactly those lines for tsc; `deno test` still
// type-checks everything normally (same pattern as delete-account/index.test.ts).

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  DAILY_INVITE_CAP,
  handler,
  MAX_PENDING_INVITES_PER_TRIP,
  secondsUntilUtcMidnight,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './index.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
const D = Deno;

// ---- Environment setup -------------------------------------------------------

D.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
D.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
D.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
D.env.set('TRIPVISOR_PUBLIC_URL', 'http://localhost:8081');
D.env.set('ALLOWED_ORIGINS', 'http://localhost:8081');

// ---- Shared constants --------------------------------------------------------

const OWNER_UID = '11111111-1111-1111-1111-000000000001';
const OWNER_EMAIL = 'owner@test.local';
const INVITEE_EMAIL = 'invitee@test.local';
const INVITEE_UID = '22222222-2222-2222-2222-000000000002';
const TRIP_ID = '33333333-3333-4444-8888-000000000003';
const COLLAB_ID = '44444444-4444-4444-4444-000000000004';
const INVITE_TOKEN = 'tok_abcdefghij1234567890';

// Two-character prefixes that distinguish owner JWT from invitee JWT in route logic.
const OWNER_JWT = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.OWNER.SIG';
const INVITEE_JWT = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.INVITEE.SIG';
const NON_OWNER_JWT = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.NONOWNER.SIG';

// ---- Helpers -----------------------------------------------------------------

interface FetchCall {
  url: string;
  method: string;
  body: string | null;
  headers: Record<string, string>;
}

function captureFetch(
  handle: (call: FetchCall) => Response | Promise<Response>,
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    const rawBody = init?.body;
    const body =
      typeof rawBody === 'string'
        ? rawBody
        : rawBody == null
          ? null
          : String(rawBody);
    const headers: Record<string, string> = {};
    if (init?.headers) {
      new Headers(init.headers as HeadersInit).forEach((v, k) => { headers[k] = v; });
    }
    const call: FetchCall = { url, method, body, headers };
    calls.push(call);
    return await Promise.resolve(handle(call));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function jsonResp(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  // 204 is a null-body status: `new Response('null', { status: 204 })` throws
  // (fetch spec), which used to surface as a spurious db_error in the accept
  // happy-path test below.
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

/**
 * Route a fetch call based on URL pattern and method. Returns a mock Response
 * appropriate for the standard happy-path scenario for manage-collaborators.
 *
 * Auth getUser is modeled by the /auth/v1/user endpoint:
 *   - calls with OWNER_JWT prefix  → OWNER_UID + OWNER_EMAIL
 *   - calls with INVITEE_JWT prefix → INVITEE_UID + INVITEE_EMAIL
 *   - all others → 401
 */
function routeAuthGetUser(authHeader: string | undefined): Response {
  if (authHeader?.includes('OWNER')) {
    return jsonResp({ user: { id: OWNER_UID, email: OWNER_EMAIL } });
  }
  if (authHeader?.includes('INVITEE')) {
    return jsonResp({ user: { id: INVITEE_UID, email: INVITEE_EMAIL } });
  }
  return jsonResp({ error: 'not authenticated' }, 401);
}

// ---- ?ping -------------------------------------------------------------------

D.test('?ping returns { ok: true, fn: "manage-collaborators" }', async () => {
  const res = await handler(
    new Request('http://localhost/?ping=1'),
  );
  assertEquals(res.status, 200);
  const body = (await res.json()) as { ok: boolean; fn: string };
  assert(body.ok === true);
  assertEquals(body.fn, 'manage-collaborators');
});

// ---- Method check ------------------------------------------------------------

D.test('GET without ?ping returns 405 method_not_allowed', async () => {
  const res = await handler(
    new Request('http://localhost/', { method: 'GET' }),
  );
  assertEquals(res.status, 405);
  const body = (await res.json()) as { error: { code: string } };
  assertEquals(body.error.code, 'method_not_allowed');
});

D.test('PATCH returns 405 method_not_allowed', async () => {
  const res = await handler(
    new Request('http://localhost/', { method: 'PATCH', body: '{}' }),
  );
  assertEquals(res.status, 405);
  const body = (await res.json()) as { error: { code: string } };
  assertEquals(body.error.code, 'method_not_allowed');
});

// ---- Input validation --------------------------------------------------------

D.test('POST with missing action returns 400 invalid_input', async () => {
  const mock = captureFetch(() => jsonResp({ user: { id: OWNER_UID, email: OWNER_EMAIL } }));
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: OWNER_JWT },
        body: JSON.stringify({ tripId: TRIP_ID }),
      }),
    );
    assertEquals(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'invalid_input');
  } finally {
    mock.restore();
  }
});

D.test('POST invite with non-UUID tripId returns 400 invalid_input', async () => {
  const mock = captureFetch(() => jsonResp({ user: { id: OWNER_UID, email: OWNER_EMAIL } }));
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: OWNER_JWT },
        body: JSON.stringify({ action: 'invite', tripId: 'not-a-uuid', inviteeEmail: INVITEE_EMAIL }),
      }),
    );
    assertEquals(res.status, 400);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'invalid_input');
  } finally {
    mock.restore();
  }
});

// ---- Authentication ----------------------------------------------------------

D.test('POST invite without bearer token returns 401 not_authenticated', async () => {
  // The handler authenticates via auth.getUser before hitting the DB.
  // With no token, the anon-client getUser call returns no user.
  const mock = captureFetch((call) => {
    if (call.url.includes('/auth/v1/user')) {
      return jsonResp({ error: 'not authenticated' }, 401);
    }
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'invite', tripId: TRIP_ID, inviteeEmail: INVITEE_EMAIL }),
      }),
    );
    assertEquals(res.status, 401);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'not_authenticated');
  } finally {
    mock.restore();
  }
});

// ---- invite: not_owner (403) -------------------------------------------------

D.test('invite action with non-owner caller returns 403 not_owner', async () => {
  // The non-owner's JWT returns a non-owner user. The trip SELECT under the
  // user-JWT returns no row (RLS hides it / user_id mismatch).
  const NON_OWNER_UID = '99999999-9999-9999-9999-000000000099';

  const mock = captureFetch((call) => {
    if (call.url.includes('/auth/v1/user')) {
      // Always return the non-owner user for this test.
      return jsonResp({ user: { id: NON_OWNER_UID, email: 'nonowner@test.local' } });
    }
    if (call.url.includes('/rest/v1/trips')) {
      // RLS: non-owner can't see the trip → return no rows.
      return jsonResp([]);
    }
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: NON_OWNER_JWT },
        body: JSON.stringify({
          action: 'invite',
          tripId: TRIP_ID,
          inviteeEmail: INVITEE_EMAIL,
        }),
      }),
    );
    assertEquals(res.status, 403);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'not_owner');
  } finally {
    mock.restore();
  }
});

// ---- accept: email_mismatch (403) --------------------------------------------

D.test('accept with caller email not matching invitee_email returns 403 email_mismatch', async () => {
  // The admin client lookup returns an invite row addressed to INVITEE_EMAIL.
  // The caller is OWNER (different email) → mismatch.

  const mock = captureFetch((call) => {
    if (call.url.includes('/auth/v1/user')) {
      return routeAuthGetUser(call.headers['authorization']);
    }
    if (call.url.includes('/rest/v1/trip_collaborators')) {
      // Return a pending invite addressed to the invitee.
      return jsonResp([{
        id: COLLAB_ID,
        trip_id: TRIP_ID,
        invitee_email: INVITEE_EMAIL,
        user_id: null,
        role: 'viewer',
        status: 'pending',
        invite_token: INVITE_TOKEN,
        created_at: new Date().toISOString(),
        accepted_at: null,
        revoked_at: null,
      }]);
    }
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });
  try {
    // Call accept with OWNER_JWT — owner's email (owner@test.local) != invitee (invitee@test.local).
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: OWNER_JWT },
        body: JSON.stringify({ action: 'accept', token: INVITE_TOKEN }),
      }),
    );
    assertEquals(res.status, 403);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'email_mismatch');
  } finally {
    mock.restore();
  }
});

// ---- accept: happy path -------------------------------------------------------

D.test('accept with matching invitee email returns 200 ok with tripId and role', async () => {
  let updateCalled = false;

  // The pending row returned for the SELECT. Supabase-js maybeSingle() sends
  // Accept: application/vnd.pgrst.object+json — PostgREST returns a single
  // JSON object (not an array). We must mirror that: return the bare object.
  const pendingRow = {
    id: COLLAB_ID,
    trip_id: TRIP_ID,
    invitee_email: INVITEE_EMAIL,
    user_id: null,
    role: 'viewer',
    status: 'pending',
    invite_token: INVITE_TOKEN,
    created_at: new Date().toISOString(),
    accepted_at: null,
    revoked_at: null,
  };

  const mock = captureFetch((call) => {
    if (call.url.includes('/auth/v1/user')) {
      // INVITEE_JWT → invitee user
      return routeAuthGetUser(call.headers['authorization']);
    }
    if (call.url.includes('/rest/v1/trip_collaborators')) {
      if (call.method === 'GET') {
        // maybeSingle() with Accept: application/vnd.pgrst.object+json expects
        // a bare JSON object (supabase-js handles both array and object).
        // Return the pending row as a single-element array; supabase-js v2
        // maybeSingle() maps the first element to data.
        return jsonResp(pendingRow);
      }
      if (call.method === 'PATCH') {
        updateCalled = true;
        return jsonResp(null, 204);
      }
    }
    return jsonResp({ error: `unexpected url=${call.url} method=${call.method}` }, 500);
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: INVITEE_JWT },
        body: JSON.stringify({ action: 'accept', token: INVITE_TOKEN }),
      }),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { ok: boolean; tripId: string; role: string };
    assert(body.ok === true);
    assertEquals(body.tripId, TRIP_ID);
    assertEquals(body.role, 'viewer');
    assert(updateCalled, 'DB update for status=accepted must have been called');
  } finally {
    mock.restore();
  }
});

// ---- revoke: not_owner (403) -------------------------------------------------

D.test('revoke action with non-owner caller returns 403 not_owner', async () => {
  const NON_OWNER_UID = '99999999-9999-9999-9999-000000000099';

  const mock = captureFetch((call) => {
    if (call.url.includes('/auth/v1/user')) {
      return jsonResp({ user: { id: NON_OWNER_UID, email: 'nonowner@test.local' } });
    }
    if (
      call.url.includes('/rest/v1/trip_collaborators') &&
      call.method === 'GET'
    ) {
      // Admin-client lookup of the collaborator row succeeds.
      return jsonResp([{
        id: COLLAB_ID,
        trip_id: TRIP_ID,
        status: 'accepted',
      }]);
    }
    if (call.url.includes('/rest/v1/trips') && call.method === 'GET') {
      // User-JWT trip SELECT: non-owner sees no rows (RLS blocks or user_id mismatch).
      return jsonResp([]);
    }
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });
  try {
    const res = await handler(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: NON_OWNER_JWT },
        body: JSON.stringify({ action: 'revoke', collaboratorId: COLLAB_ID }),
      }),
    );
    assertEquals(res.status, 403);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'not_owner');
  } finally {
    mock.restore();
  }
});

// ---- invite: spam caps (security audit #14) ------------------------------------

/**
 * Invite fixture for the OWNER. Knobs:
 *   pending  — live pending-invite count the HEAD count query reports
 *   quota    — consume_invite_quota RPC result (true/false), or 'error'
 */
function inviteRoutes(opts: { pending: number; quota: boolean | 'error' }) {
  return (call: FetchCall): Response => {
    if (call.url.includes('/auth/v1/user')) return routeAuthGetUser(call.headers['authorization']);
    if (call.url.includes('/auth/v1/invite')) {
      return jsonResp({ id: INVITEE_UID, email: INVITEE_EMAIL });
    }
    if (call.url.includes('/rest/v1/trips')) {
      return jsonResp({ id: TRIP_ID, user_id: OWNER_UID, title: 'Lisbon' });
    }
    if (call.url.includes('/rest/v1/rpc/consume_invite_quota')) {
      if (opts.quota === 'error') {
        return jsonResp({ code: 'PGRST202', message: 'Could not find the function' }, 404);
      }
      return jsonResp(opts.quota);
    }
    if (call.url.includes('/rest/v1/trip_collaborators')) {
      if (call.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { 'content-range': `*/${opts.pending}` } });
      }
      if (call.method === 'GET') return jsonResp([]); // no existing invite for this email
      if (call.method === 'POST') {
        return jsonResp({ id: COLLAB_ID, invite_token: INVITE_TOKEN }, 201);
      }
    }
    return jsonResp({ error: `unexpected ${call.method} ${call.url}` }, 500);
  };
}

function inviteRequest(): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: OWNER_JWT },
    body: JSON.stringify({ action: 'invite', tripId: TRIP_ID, inviteeEmail: INVITEE_EMAIL }),
  });
}

const collabInserts = (calls: FetchCall[]) =>
  calls.filter((c) => c.url.includes('/rest/v1/trip_collaborators') && c.method === 'POST');
const emailSends = (calls: FetchCall[]) => calls.filter((c) => c.url.includes('/auth/v1/invite'));
const quotaCalls = (calls: FetchCall[]) => calls.filter((c) => c.url.includes('/rpc/consume_invite_quota'));

D.test('invite (owner, under both caps) → 200, consumes one quota unit, inserts + emails', async () => {
  const mock = captureFetch(inviteRoutes({ pending: 3, quota: true }));
  try {
    const res = await handler(inviteRequest());
    assertEquals(res.status, 200);
    const body = (await res.json()) as { ok: boolean; collaboratorId: string; emailSent: boolean };
    assert(body.ok === true);
    assertEquals(body.collaboratorId, COLLAB_ID);
    assertEquals(body.emailSent, true);
    const rpc = quotaCalls(mock.calls);
    assertEquals(rpc.length, 1, 'exactly one quota consume per invite');
    assertEquals(JSON.parse(rpc[0]!.body ?? '{}'), { p_user: OWNER_UID, p_cap: DAILY_INVITE_CAP });
    assertEquals(collabInserts(mock.calls).length, 1);
    assertEquals(emailSends(mock.calls).length, 1);
  } finally {
    mock.restore();
  }
});

D.test('audit #14: invite over the daily cap → 429 invite_rate_limited, Retry-After, no row, no email', async () => {
  const mock = captureFetch(inviteRoutes({ pending: 0, quota: false }));
  try {
    const res = await handler(inviteRequest());
    assertEquals(res.status, 429);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assertEquals(body.error.code, 'invite_rate_limited');
    assert(body.error.message.includes(String(DAILY_INVITE_CAP)), 'message names the cap');
    const retryAfter = Number(res.headers.get('Retry-After'));
    assert(retryAfter >= 1 && retryAfter <= 86_400, `Retry-After must be 1..86400s, got ${retryAfter}`);
    assertEquals(collabInserts(mock.calls).length, 0, 'no trip_collaborators row');
    assertEquals(emailSends(mock.calls).length, 0, 'no inviteUserByEmail (no auth.users row)');
  } finally {
    mock.restore();
  }
});

D.test('audit #14: trip at the pending-invite cap → 429 trip_invite_limit, quota NOT consumed', async () => {
  const mock = captureFetch(inviteRoutes({ pending: MAX_PENDING_INVITES_PER_TRIP, quota: true }));
  try {
    const res = await handler(inviteRequest());
    assertEquals(res.status, 429);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'trip_invite_limit');
    assertEquals(quotaCalls(mock.calls).length, 0, 'a refused request must not burn daily quota');
    assertEquals(collabInserts(mock.calls).length, 0);
    assertEquals(emailSends(mock.calls).length, 0);
    // The pending count only considers live (non-expired) pending rows.
    const head = mock.calls.find((c) => c.method === 'HEAD' && c.url.includes('/trip_collaborators'));
    assert(head, 'pending count query must run');
    assert(head!.url.includes('status=eq.pending'), `count must filter status=pending: ${head!.url}`);
    assert(/created_at=gte\./.test(head!.url), `count must ignore expired invites: ${head!.url}`);
  } finally {
    mock.restore();
  }
});

D.test('audit #14: quota RPC failure fails CLOSED → 503 quota_unavailable, no row, no email', async () => {
  const mock = captureFetch(inviteRoutes({ pending: 0, quota: 'error' }));
  try {
    const res = await handler(inviteRequest());
    assertEquals(res.status, 503);
    const body = (await res.json()) as { error: { code: string } };
    assertEquals(body.error.code, 'quota_unavailable');
    assertEquals(collabInserts(mock.calls).length, 0);
    assertEquals(emailSends(mock.calls).length, 0);
  } finally {
    mock.restore();
  }
});

D.test('audit #14: a non-owner never reaches the quota (403 before any cap work)', async () => {
  const mock = captureFetch((call) => {
    if (call.url.includes('/auth/v1/user')) return jsonResp({ user: { id: INVITEE_UID, email: INVITEE_EMAIL } });
    if (call.url.includes('/rest/v1/trips')) return jsonResp({ id: TRIP_ID, user_id: OWNER_UID, title: 'Lisbon' });
    return jsonResp({ error: `unexpected ${call.url}` }, 500);
  });
  try {
    const res = await handler(inviteRequest());
    assertEquals(res.status, 403);
    assertEquals(quotaCalls(mock.calls).length, 0);
  } finally {
    mock.restore();
  }
});

D.test('secondsUntilUtcMidnight: counts down to the next UTC day, never 0', () => {
  assertEquals(secondsUntilUtcMidnight(new Date('2026-09-29T23:59:30Z')), 30);
  assertEquals(secondsUntilUtcMidnight(new Date('2026-09-29T00:00:00Z')), 86_400);
  assertEquals(secondsUntilUtcMidnight(new Date('2026-12-31T12:00:00Z')), 43_200);
  assertEquals(secondsUntilUtcMidnight(new Date('2026-09-29T23:59:59.900Z')), 1);
});
