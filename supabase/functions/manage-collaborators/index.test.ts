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

import {
  assert,
  assertEquals,
} from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

// ---- Environment setup -------------------------------------------------------

Deno.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
Deno.env.set('TRIPVISOR_PUBLIC_URL', 'http://localhost:8081');
Deno.env.set('ALLOWED_ORIGINS', 'http://localhost:8081');

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

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
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

Deno.test('?ping returns { ok: true, fn: "manage-collaborators" }', async () => {
  const res = await handler(
    new Request('http://localhost/?ping=1'),
  );
  assertEquals(res.status, 200);
  const body = (await res.json()) as { ok: boolean; fn: string };
  assert(body.ok === true);
  assertEquals(body.fn, 'manage-collaborators');
});

// ---- Method check ------------------------------------------------------------

Deno.test('GET without ?ping returns 405 method_not_allowed', async () => {
  const res = await handler(
    new Request('http://localhost/', { method: 'GET' }),
  );
  assertEquals(res.status, 405);
  const body = (await res.json()) as { error: { code: string } };
  assertEquals(body.error.code, 'method_not_allowed');
});

Deno.test('PATCH returns 405 method_not_allowed', async () => {
  const res = await handler(
    new Request('http://localhost/', { method: 'PATCH', body: '{}' }),
  );
  assertEquals(res.status, 405);
  const body = (await res.json()) as { error: { code: string } };
  assertEquals(body.error.code, 'method_not_allowed');
});

// ---- Input validation --------------------------------------------------------

Deno.test('POST with missing action returns 400 invalid_input', async () => {
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

Deno.test('POST invite with non-UUID tripId returns 400 invalid_input', async () => {
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

Deno.test('POST invite without bearer token returns 401 not_authenticated', async () => {
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

Deno.test('invite action with non-owner caller returns 403 not_owner', async () => {
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

Deno.test('accept with caller email not matching invitee_email returns 403 email_mismatch', async () => {
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

Deno.test('accept with matching invitee email returns 200 ok with tripId and role', async () => {
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

Deno.test('revoke action with non-owner caller returns 403 not_owner', async () => {
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
