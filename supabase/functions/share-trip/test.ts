// share-trip Edge Function — Deno integration tests.
//
// Run with (repo root; the docker form is in docs/v2/m5-handoff.md):
//   deno test --allow-env --allow-net=127.0.0.1 supabase/functions/share-trip/test.ts
//
// The tests mock globalThis.fetch to intercept all outbound HTTP calls
// (GoTrue `/auth/v1/user` for caller identity, PostgREST, Storage signing).
// We return PostgREST-compliant response bodies so the @supabase/supabase-js
// client processes them correctly.
//
// The Supabase JS client uses maybeSingle() which, for GET, accepts a JSON
// array (0 or 1 row) or a bare object. For array responses (normal
// .select()), it expects a JSON array.
//
// Pattern: follows supabase/functions/place-details/test.ts.
//
// The repo-root `npx tsc` (Expo tsconfig) also type-checks this file but
// cannot resolve Deno URL / `.ts`-suffixed imports or the `Deno` global. The
// `@ts-ignore`s below silence exactly those lines for tsc; `deno test` still
// type-checks everything normally (same pattern as delete-account/index.test.ts).

// @ts-ignore -- Deno URL import (unresolvable under the Expo tsconfig)
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { handler } from './handler.ts';
import {
  buildPublicMemories,
  buildPublicSharePayload,
  DEFAULT_SHARE_SETTINGS,
  FORBIDDEN_PUBLIC_KEYS,
  isPublicMemoryRow,
  LEG_FIELDS,
  photoPathsToSign,
  PLACE_FIELDS,
  PUBLIC_PLACE_KEYS,
  PUBLIC_TRIP_KEYS,
  SHARE_READ_CONTRACT_VERSION,
  settingsFromRow,
  settingsToColumns,
  TRIP_FIELDS,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './public-fields.ts';
import {
  homeRate,
  rateKey,
  rateLookupsNeeded,
  summarizeExpenses,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './expense-summary.ts';
import {
  clientIp,
  normaliseIp,
  rateKeys,
  SHARE_RATE_LIMITS,
  // @ts-ignore -- Deno `.ts`-suffixed import
} from './rate-limit.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
const D = Deno;

// ---- Environment setup -----------------------------------------------------

D.env.set('SUPABASE_URL', 'http://127.0.0.1:54321');
D.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
D.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
D.env.set('ALLOWED_ORIGINS', '*');

// ---- Identities --------------------------------------------------------------

const OWNER_ID = '11111111-1111-4111-8111-000000000001';
const VIEWER_ID = '22222222-2222-4222-8222-000000000002';
const EDITOR_ID = '33333333-3333-4333-8333-000000000003';

// Fake bearer tokens — not verified here; the `/auth/v1/user` mock maps the
// marker in the token to a user (the real GoTrue verifies signatures).
const OWNER_JWT = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.OWNER.SIG';
const VIEWER_JWT = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.VIEWER.SIG';
const EDITOR_JWT = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.EDITOR.SIG';
// What anonymous share viewers send (the project anon key): GoTrue says 401.
const ANON_JWT = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ANONKEY.SIG';

const VALID_TRIP_ID = '00000000-0000-4000-8000-000000000001';
const LIVE_TOKEN = 'live-token-value-123456789';

// ---- Mock helpers ------------------------------------------------------------

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

/** GoTrue `GET /auth/v1/user` — maps the token marker to a user id. */
function authUser(init: RequestInit | undefined): Response {
  const auth = new Headers(init?.headers as HeadersInit).get('authorization') ?? '';
  if (auth.includes('.OWNER.')) return json({ id: OWNER_ID, aud: 'authenticated' });
  if (auth.includes('.VIEWER.')) return json({ id: VIEWER_ID, aud: 'authenticated' });
  if (auth.includes('.EDITOR.')) return json({ id: EDITOR_ID, aud: 'authenticated' });
  return json({ code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' }, 401);
}

interface Call {
  url: string;
  method: string;
  body: string | null;
}

/**
 * Install a fetch stub. `/auth/v1/user` is always routed through `authUser`;
 * everything else goes to `route` (return undefined → 500 "unmatched").
 */
function stubFetch(route: (url: string, method: string, init?: RequestInit) => Response | undefined) {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method, body: typeof init?.body === 'string' ? init.body : null });
    if (url.includes('/auth/v1/user')) return Promise.resolve(authUser(init));
    const res = route(url, method, init);
    if (res) return Promise.resolve(res);
    console.error(`[stubFetch] unmatched URL: ${method} ${url}`);
    return Promise.resolve(json({ message: 'unmatched url in mock' }, 500));
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** `trips` ownership lookup under the caller's JWT: the row RLS lets them see. */
const tripsRow = (userId: string) => (url: string) =>
  /\/rest\/v1\/trips\b/.test(url) && !url.includes('/trip_') ? json({ id: VALID_TRIP_ID, user_id: userId }) : undefined;

function post(body: unknown, auth?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) headers.Authorization = auth;
  return new Request('http://localhost/', { method: 'POST', headers, body: JSON.stringify(body) });
}

const sharesWrites = (calls: Call[]) =>
  calls.filter((c) => c.url.includes('/trip_shares') && (c.method === 'POST' || c.method === 'PATCH'));

const touched = (calls: Call[], table: string) => calls.filter((c) => c.url.includes(`/rest/v1/${table}`));

type ErrBody = { error: { code: string } };

// ---- ?ping -----------------------------------------------------------------

D.test('?ping returns { ok: true, fn: "share-trip" }', async () => {
  const res = await handler(new Request('http://localhost/?ping=1'));
  assertEquals(res.status, 200);
  const body = (await res.json()) as { ok: boolean; fn: string };
  assert(body.ok === true);
  assertEquals(body.fn, 'share-trip');
});

// ---- Input validation -------------------------------------------------------

D.test('POST with invalid JSON returns 400', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    }),
  );
  assertEquals(res.status, 400);
  const body = (await res.json()) as ErrBody;
  assertEquals(body.error.code, 'invalid_input');
});

D.test('POST with unknown op returns 400', async () => {
  const res = await handler(post({ op: 'delete_everything' }));
  assertEquals(res.status, 400);
});

D.test('GET (non-ping) returns 405', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 405);
});

D.test('op:create with invalid tripId UUID returns 400', async () => {
  const res = await handler(post({ op: 'create', tripId: 'not-a-uuid' }, OWNER_JWT));
  assertEquals(res.status, 400);
});

D.test('op:read token shorter than 16 chars returns 400 (Zod validation)', async () => {
  const res = await handler(post({ op: 'read', token: 'short' }));
  assertEquals(res.status, 400);
});

D.test('op:update_settings needs at least one known toggle (400 before any network call)', async () => {
  const mock = stubFetch(() => undefined);
  try {
    for (const settings of [{}, { showNotes: true }, { showMemories: 'yes' }]) {
      const res = await handler(post({ op: 'update_settings', tripId: VALID_TRIP_ID, settings }, OWNER_JWT));
      assertEquals(res.status, 400, JSON.stringify(settings));
      assertEquals(((await res.json()) as ErrBody).error.code, 'invalid_input');
    }
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

// ---- CORS preflight ---------------------------------------------------------

D.test('OPTIONS preflight returns 204', async () => {
  const res = await handler(
    new Request('http://localhost/', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:8081' },
    }),
  );
  assertEquals(res.status, 204);
});

// ---- op: create — owner happy path -------------------------------------------

/** Create fixture: owner lookup → newest active link (`prev`) → insert. */
function createRoutes(ownerId: string, prev: Record<string, unknown> | null = null) {
  return (url: string, method: string): Response | undefined =>
    tripsRow(ownerId)(url) ??
    (url.includes('/trip_shares') && method === 'POST' ? json([{ id: 'share-row-1' }], 201) : undefined) ??
    (url.includes('/trip_shares') && method === 'GET' ? json(prev ? [prev] : []) : undefined);
}

D.test('op:create by the OWNER returns { token } (+ v3 createdAt, default settings)', async () => {
  const mock = stubFetch(createRoutes(OWNER_ID));
  try {
    const res = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, OWNER_JWT));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { token: string; createdAt: string; settings: unknown };
    assert(typeof body.token === 'string', 'token must be a string');
    assert(body.token.length >= 20, `Token too short: ${body.token}`);
    assert(/^[A-Za-z0-9_-]+$/.test(body.token), 'Token should be base64url');
    assert(!Number.isNaN(Date.parse(body.createdAt)), 'createdAt is an ISO time');
    assertEquals(body.settings, { showItinerary: true, showExpenses: false, showMemories: false });
    const writes = sharesWrites(mock.calls);
    assertEquals(writes.length, 1, 'exactly one trip_shares insert');
    const inserted = JSON.parse(writes[0]!.body ?? '{}') as Record<string, unknown>;
    assertEquals(inserted.show_itinerary, true);
    assertEquals(inserted.show_expenses, false, 'expenses are private by default');
    assertEquals(inserted.show_memories, false, 'memories are private by default');
  } finally {
    mock.restore();
  }
});

D.test('op:create inherits the newest active link toggles; explicit settings win', async () => {
  const mock = stubFetch(
    createRoutes(OWNER_ID, { created_at: '2026-09-01T00:00:00Z', show_itinerary: false, show_expenses: true, show_memories: false }),
  );
  try {
    const res = await handler(
      post({ op: 'create', tripId: VALID_TRIP_ID, settings: { showMemories: true } }, OWNER_JWT),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as { settings: unknown };
    assertEquals(body.settings, { showItinerary: false, showExpenses: true, showMemories: true });
    const inserted = JSON.parse(sharesWrites(mock.calls)[0]!.body ?? '{}') as Record<string, unknown>;
    assertEquals(
      [inserted.show_itinerary, inserted.show_expenses, inserted.show_memories],
      [false, true, true],
    );
  } finally {
    mock.restore();
  }
});

D.test('op:create fails CLOSED when the inherit read fails (no link minted)', async () => {
  const mock = stubFetch((url, method) =>
    tripsRow(OWNER_ID)(url) ??
    (url.includes('/trip_shares') && method === 'GET' ? json({ message: 'boom' }, 500) : undefined));
  try {
    const res = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, OWNER_JWT));
    assertEquals(res.status, 500);
    assertEquals(sharesWrites(mock.calls).length, 0);
  } finally {
    mock.restore();
  }
});

// ---- op: create — audit #5: non-owners are refused ---------------------------

D.test('audit #5: op:create by an accepted VIEWER → 403 not_owner, nothing written', async () => {
  // RLS lets the viewer SEE the trip (that is what the old check relied on);
  // the owner gate must still refuse because user_id !== caller.
  const mock = stubFetch((url) => tripsRow(OWNER_ID)(url));
  try {
    const res = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, VIEWER_JWT));
    assertEquals(res.status, 403);
    const body = (await res.json()) as ErrBody;
    assertEquals(body.error.code, 'not_owner');
    assertEquals(sharesWrites(mock.calls).length, 0, 'no trip_shares write for a viewer');
    assert(
      !mock.calls.some((c) => c.url.includes('/trip_shares')),
      'trip_shares must not even be touched',
    );
  } finally {
    mock.restore();
  }
});

D.test('audit #5: op:create by an accepted EDITOR → 403 not_owner (owner-only by design)', async () => {
  const mock = stubFetch((url) => tripsRow(OWNER_ID)(url));
  try {
    const res = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, EDITOR_JWT));
    assertEquals(res.status, 403);
    assertEquals(((await res.json()) as ErrBody).error.code, 'not_owner');
    assertEquals(sharesWrites(mock.calls).length, 0);
  } finally {
    mock.restore();
  }
});

D.test('op:create without a bearer → 401 not_authenticated before any DB call', async () => {
  const mock = stubFetch(() => undefined);
  try {
    const res = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }));
    assertEquals(res.status, 401);
    assertEquals(((await res.json()) as ErrBody).error.code, 'not_authenticated');
    assertEquals(mock.calls.length, 0, 'no network call without a bearer');
  } finally {
    mock.restore();
  }
});

D.test('op:create with the anon key as bearer → 401 (GoTrue rejects), no DB call', async () => {
  const mock = stubFetch(() => undefined);
  try {
    const res = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, ANON_JWT));
    assertEquals(res.status, 401);
    assert(!mock.calls.some((c) => c.url.includes('/rest/v1/')), 'no PostgREST call');
  } finally {
    mock.restore();
  }
});

D.test('op:create on a trip RLS hides from the caller → 404 not_found', async () => {
  // maybeSingle(): empty array = no matching rows.
  const mock = stubFetch((url) => (url.includes('/rest/v1/trips') ? json([]) : undefined));
  try {
    const res = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, VIEWER_JWT));
    assertEquals(res.status, 404);
    assertEquals(sharesWrites(mock.calls).length, 0);
  } finally {
    mock.restore();
  }
});

// ---- op: current (owner "get current link") -----------------------------------

const LIVE_LINK_ROW = {
  token: LIVE_TOKEN,
  created_at: '2026-09-20T10:00:00Z',
  show_itinerary: true,
  show_expenses: false,
  show_memories: true,
};

D.test('op:current by the OWNER returns the newest active link with its toggles', async () => {
  let sharesUrl = '';
  const mock = stubFetch((url) => {
    const t = tripsRow(OWNER_ID)(url);
    if (t) return t;
    if (url.includes('/trip_shares')) {
      sharesUrl = url;
      return json([LIVE_LINK_ROW]);
    }
    return undefined;
  });
  try {
    const res = await handler(post({ op: 'current', tripId: VALID_TRIP_ID }, OWNER_JWT));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { share: unknown; meta: { contractVersion: number } };
    assertEquals(body.share, {
      token: LIVE_TOKEN,
      createdAt: '2026-09-20T10:00:00Z',
      settings: { showItinerary: true, showExpenses: false, showMemories: true },
    });
    assertEquals(body.meta.contractVersion, 4);
    assert(/revoked_at=is\.null/.test(sharesUrl), `must skip revoked links: ${sharesUrl}`);
    assert(/order=created_at\.desc/.test(sharesUrl), `newest first: ${sharesUrl}`);
    assert(sharesUrl.includes(`trip_id=eq.${VALID_TRIP_ID}`), 'scoped to the trip');
    assertEquals(sharesWrites(mock.calls).length, 0, 'a read never writes');
  } finally {
    mock.restore();
  }
});

D.test('op:current with no active link → { share: null }', async () => {
  const mock = stubFetch((url) => tripsRow(OWNER_ID)(url) ?? (url.includes('/trip_shares') ? json([]) : undefined));
  try {
    const res = await handler(post({ op: 'current', tripId: VALID_TRIP_ID }, OWNER_JWT));
    assertEquals(res.status, 200);
    assertEquals(((await res.json()) as { share: unknown }).share, null);
  } finally {
    mock.restore();
  }
});

for (const [who, jwt] of [['VIEWER', VIEWER_JWT], ['EDITOR', EDITOR_JWT]] as const) {
  D.test(`op:current by an accepted ${who} → 403 not_owner; the token is never read`, async () => {
    const mock = stubFetch((url) =>
      tripsRow(OWNER_ID)(url) ?? (url.includes('/trip_shares') ? json([LIVE_LINK_ROW]) : undefined));
    try {
      const res = await handler(post({ op: 'current', tripId: VALID_TRIP_ID }, jwt));
      assertEquals(res.status, 403);
      const text = await res.text();
      assertEquals((JSON.parse(text) as ErrBody).error.code, 'not_owner');
      assert(!text.includes(LIVE_TOKEN), 'the live token must never reach a collaborator');
      assertEquals(touched(mock.calls, 'trip_shares').length, 0, 'trip_shares must not be touched');
    } finally {
      mock.restore();
    }
  });
}

D.test('op:current without auth → 401, no DB call', async () => {
  const mock = stubFetch(() => undefined);
  try {
    const res = await handler(post({ op: 'current', tripId: VALID_TRIP_ID }));
    assertEquals(res.status, 401);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

// ---- op: update_settings (owner toggles) ----------------------------------------

function updateRoutes(ownerId: string, returned: Array<Record<string, unknown>>) {
  return (url: string, method: string): Response | undefined =>
    tripsRow(ownerId)(url) ??
    (url.includes('/trip_shares') && method === 'PATCH' ? json(returned) : undefined);
}

D.test('op:update_settings by the OWNER patches only the given toggles on active links', async () => {
  const mock = stubFetch(updateRoutes(OWNER_ID, [
    { ...LIVE_LINK_ROW, created_at: '2026-09-01T00:00:00Z', token: 'older-token-value-12345678', show_expenses: true },
    { ...LIVE_LINK_ROW, show_expenses: true },
  ]));
  try {
    const res = await handler(
      post({ op: 'update_settings', tripId: VALID_TRIP_ID, settings: { showExpenses: true } }, OWNER_JWT),
    );
    assertEquals(res.status, 200);
    const body = (await res.json()) as {
      share: { token: string; settings: unknown };
      updated: number;
      meta: { contractVersion: number };
    };
    assertEquals(body.updated, 2);
    assertEquals(body.share.token, LIVE_TOKEN, 'the newest link is the one reported');
    assertEquals(body.share.settings, { showItinerary: true, showExpenses: true, showMemories: true });
    const writes = sharesWrites(mock.calls);
    assertEquals(writes.length, 1);
    assertEquals(JSON.parse(writes[0]!.body ?? '{}'), { show_expenses: true }, 'only the given column');
    assert(/revoked_at=is\.null/.test(writes[0]!.url), 'revoked links stay untouched');
    assert(writes[0]!.url.includes(`trip_id=eq.${VALID_TRIP_ID}`), 'scoped to the trip');
    assert(!writes[0]!.url.includes('token=eq.'), 'no token → every active link of the trip');
  } finally {
    mock.restore();
  }
});

D.test('op:update_settings with a token targets that link (still scoped to the trip)', async () => {
  const mock = stubFetch(updateRoutes(OWNER_ID, [{ ...LIVE_LINK_ROW, show_memories: false }]));
  try {
    const res = await handler(
      post(
        { op: 'update_settings', tripId: VALID_TRIP_ID, token: LIVE_TOKEN, settings: { showMemories: false } },
        OWNER_JWT,
      ),
    );
    assertEquals(res.status, 200);
    const url = sharesWrites(mock.calls)[0]!.url;
    assert(url.includes(`token=eq.${LIVE_TOKEN}`) && url.includes(`trip_id=eq.${VALID_TRIP_ID}`), url);
  } finally {
    mock.restore();
  }
});

D.test('op:update_settings with no active link → 404 no_active_link', async () => {
  const mock = stubFetch(updateRoutes(OWNER_ID, []));
  try {
    const res = await handler(
      post({ op: 'update_settings', tripId: VALID_TRIP_ID, settings: { showMemories: true } }, OWNER_JWT),
    );
    assertEquals(res.status, 404);
    assertEquals(((await res.json()) as ErrBody).error.code, 'no_active_link');
  } finally {
    mock.restore();
  }
});

for (const [who, jwt] of [['VIEWER', VIEWER_JWT], ['EDITOR', EDITOR_JWT]] as const) {
  D.test(`op:update_settings by an accepted ${who} → 403 not_owner, nothing written`, async () => {
    const mock = stubFetch(updateRoutes(OWNER_ID, [LIVE_LINK_ROW]));
    try {
      const res = await handler(
        post({ op: 'update_settings', tripId: VALID_TRIP_ID, settings: { showMemories: true } }, jwt),
      );
      assertEquals(res.status, 403);
      assertEquals(((await res.json()) as ErrBody).error.code, 'not_owner');
      assertEquals(sharesWrites(mock.calls).length, 0);
      assertEquals(touched(mock.calls, 'trip_shares').length, 0);
    } finally {
      mock.restore();
    }
  });
}

// ---- op: read — missing / revoked token --------------------------------------

D.test('op:read with missing token → 404', async () => {
  const mock = stubFetch((url) => (url.includes('/trip_shares') ? json([]) : undefined));
  try {
    const res = await handler(post({ op: 'read', token: 'nonexistent-token-value-1234567' }));
    assertEquals(res.status, 404);
    const body = (await res.json()) as ErrBody;
    assertEquals(body.error.code, 'not_found');
  } finally {
    mock.restore();
  }
});

D.test('op:read with revoked token returns 404', async () => {
  const mock = stubFetch((url) =>
    url.includes('/trip_shares') ? json({ trip_id: 'trip-aaa', revoked_at: '2026-04-01T00:00:00Z' }) : undefined);
  try {
    const res = await handler(post({ op: 'read', token: 'revoked-token-value-12345678' }));
    assertEquals(res.status, 404);
  } finally {
    mock.restore();
  }
});

// ---- op: read — fixtures ------------------------------------------------------

interface ReadCapture {
  tripsUrl?: string;
  placesUrl?: string;
  expensesUrls: string[];
  journalUrl?: string;
  reviewsUrl?: string;
  photosUrl?: string;
  signBodies: Array<{ expiresIn: number; paths: string[] }>;
  rateCalls: Array<Record<string, unknown>>;
}

const newCapture = (): ReadCapture => ({ expensesUrls: [], signBodies: [], rateCalls: [] });

/** trip_shares.id of the fixture link (the per-link counter key). */
const SHARE_ROW_ID = '99999999-9999-4999-8999-000000000001';

// Memories are public only when authored by the trip OWNER (trips.user_id).
const AUTHOR = OWNER_ID;
/** An accepted collaborator: their `trip`-visibility items are for members, never public. */
const COLLAB_AUTHOR = '55555555-5555-4555-8555-000000000005';
const photoPath = (id: string, thumb = false, author = AUTHOR) =>
  `${VALID_TRIP_ID}/${author}/${id}${thumb ? '_t' : ''}.jpg`;

/** Memory rows: one of each private flavour next to the shared ones. */
const JOURNAL_ROWS = [
  { id: 'j-shared', day_index: 0, body: 'Sunset at the tower', created_at: '2026-06-01T20:00:00Z', visibility: 'trip', deleted: false, author_id: AUTHOR },
  { id: 'j-private', day_index: 0, body: 'SECRET diary', created_at: '2026-06-01T21:00:00Z', visibility: 'only_me', deleted: false, author_id: AUTHOR },
  { id: 'j-deleted', day_index: 1, body: 'deleted text', created_at: '2026-06-02T21:00:00Z', visibility: 'trip', deleted: true, author_id: AUTHOR },
  { id: 'j-empty', day_index: 1, body: '   ', created_at: '2026-06-02T22:00:00Z', visibility: 'trip', deleted: false, author_id: AUTHOR },
  { id: 'j-collab', day_index: 0, body: 'COLLAB journal', created_at: '2026-06-01T20:30:00Z', visibility: 'trip', deleted: false, author_id: COLLAB_AUTHOR },
];
const REVIEW_ROWS = [
  { id: 'r-linked', trip_place_id: 'place-1', rating: 5, body: 'Loved it', created_at: '2026-06-01T12:00:00Z', place_name_snapshot: 'Old name', visibility: 'trip', deleted: false, author_id: AUTHOR },
  { id: 'r-detached', trip_place_id: null, rating: 3, body: '', created_at: '2026-06-02T12:00:00Z', place_name_snapshot: 'Removed Cafe', visibility: 'trip', deleted: false, author_id: AUTHOR },
  { id: 'r-private', trip_place_id: 'place-1', rating: 1, body: 'SECRET review', created_at: '2026-06-02T13:00:00Z', place_name_snapshot: 'x', visibility: 'only_me', deleted: false, author_id: AUTHOR },
  { id: 'r-collab', trip_place_id: 'place-1', rating: 2, body: 'COLLAB review', created_at: '2026-06-02T14:00:00Z', place_name_snapshot: 'x', visibility: 'trip', deleted: false, author_id: COLLAB_AUTHOR },
];
const PHOTO_ROWS = [
  { id: 'ph-shared', day_index: 0, trip_place_id: 'place-1', storage_path: photoPath('ph-shared'), thumb_path: photoPath('ph-shared', true), width: 1600, height: 1200, caption: 'Tower', taken_at: '2026-06-01T18:00:00Z', created_at: '2026-06-01T18:05:00Z', visibility: 'trip', deleted: false, status: 'ready', author_id: AUTHOR },
  { id: 'ph-private', day_index: 0, trip_place_id: null, storage_path: photoPath('ph-private'), thumb_path: photoPath('ph-private', true), width: 1600, height: 1200, caption: 'SECRET photo', taken_at: null, created_at: '2026-06-01T19:00:00Z', visibility: 'only_me', deleted: false, status: 'ready', author_id: AUTHOR },
  { id: 'ph-pending', day_index: 0, trip_place_id: null, storage_path: photoPath('ph-pending'), thumb_path: photoPath('ph-pending', true), width: null, height: null, caption: null, taken_at: null, created_at: '2026-06-01T19:30:00Z', visibility: 'trip', deleted: false, status: 'pending', author_id: AUTHOR },
  { id: 'ph-collab', day_index: 0, trip_place_id: 'place-1', storage_path: photoPath('ph-collab', false, COLLAB_AUTHOR), thumb_path: photoPath('ph-collab', true, COLLAB_AUTHOR), width: 800, height: 600, caption: 'COLLAB photo', taken_at: null, created_at: '2026-06-01T19:40:00Z', visibility: 'trip', deleted: false, status: 'ready', author_id: COLLAB_AUTHOR },
];

/**
 * Anonymous read fixture. The DB rows deliberately carry MORE than the
 * allow-list, and the memory tables return private rows too (as if the query
 * filter had been dropped): the payload must still be clean.
 */
function readRoutes(
  tripId: string,
  captured: Partial<ReadCapture>,
  share: Record<string, unknown> = {},
  opts: { expenses?: unknown[]; fxRates?: unknown[]; rate?: unknown; rateStatus?: number } = {},
) {
  return (url: string, method: string, init?: RequestInit): Response | undefined => {
    if (url.includes('/rpc/consume_share_read')) {
      captured.rateCalls?.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return json(opts.rate ?? { allowed: true, scope: null, retry_after: 0 }, opts.rateStatus ?? 200);
    }
    if (url.includes('/trip_shares')) return json([{ id: SHARE_ROW_ID, trip_id: tripId, revoked_at: null, ...share }]);
    if (url.includes('/trip_places')) {
      captured.placesUrl = url;
      return json([{
        id: 'place-1',
        google_place_id: 'ChIJ_1',
        user_title: 'Belem Tower',
        category: 'attraction',
        lat: 38.7,
        lng: -9.2,
        visit_duration_minutes: 75,
        day_index: 0,
        order_in_day: 0,
        notes: 'PRIVATE: door code 1234', // must never reach the anonymous viewer
        trip_id: tripId,
      }]);
    }
    if (url.includes('/trip_legs')) return json([]);
    if (url.includes('/trip_expenses')) {
      captured.expensesUrls?.push(url);
      return json(opts.expenses ?? []);
    }
    if (url.includes('/fx_rates')) return json(opts.fxRates ?? []);
    if (url.includes('/trip_journal_entries')) {
      captured.journalUrl = url;
      return json(JOURNAL_ROWS);
    }
    if (url.includes('/trip_place_reviews')) {
      captured.reviewsUrl = url;
      return json(REVIEW_ROWS);
    }
    if (url.includes('/trip_photos')) {
      captured.photosUrl = url;
      return json(PHOTO_ROWS);
    }
    if (url.includes('/storage/v1/object/sign/trip-memories') && method === 'POST') {
      const req = JSON.parse(String(init?.body ?? '{}')) as { expiresIn: number; paths: string[] };
      captured.signBodies?.push(req);
      return json(req.paths.map((p) => ({ path: p, signedURL: `/object/sign/trip-memories/${p}?token=sig-${p.length}`, error: null })));
    }
    if (url.includes('/trips')) {
      captured.tripsUrl = url;
      return json([{
        id: tripId, // must never reach the anonymous viewer (audit #12)
        user_id: OWNER_ID, // must never reach the anonymous viewer
        title: 'Shared Trip',
        start_date: '2026-06-01',
        end_date: '2026-06-03',
        daily_hours_budget: 8,
        transport_mode: 'driving',
        timezone: 'Europe/Lisbon',
        currency: 'TRY',
      }]);
    }
    return undefined;
  };
}

type ReadBody = {
  trip: Record<string, unknown>;
  places: Array<Record<string, unknown>>;
  legs: unknown[];
  sections: { itinerary: boolean; expenses: boolean; memories: boolean };
  expenses?: Record<string, unknown>;
  memories?: {
    journal: Array<Record<string, unknown>>;
    reviews: Array<Record<string, unknown>>;
    photos: Array<Record<string, unknown>>;
    photoUrlExpiresAt: string | null;
    truncated: boolean;
  };
  meta: { contractVersion: number };
};

const MEMORY_TABLES = ['trip_journal_entries', 'trip_place_reviews', 'trip_photos'];

// ---- op: read — happy path + audit #12 --------------------------------------

D.test('op:read returns trip + places + legs + meta.contractVersion 4 (no user_id / trip.id / notes)', async () => {
  const TRIP_ID = '00000000-0000-4000-8000-000000000099';
  const captured = newCapture();
  const mock = stubFetch(readRoutes(TRIP_ID, captured));
  try {
    const res = await handler(post({ op: 'read', token: 'validtoken12345678901234' }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as ReadBody;
    assertEquals(body.trip.title, 'Shared Trip');
    assertEquals(body.meta.contractVersion, 4);
    assert(!('user_id' in body.trip), 'user_id must NOT appear in the response');
    assert(!('id' in body.trip), 'audit #12: trip.id must NOT appear in the response');
    assert(!('currency' in body.trip), 'currency is not on the v2 trip allow-list');
    assertEquals(body.places.length, 1);
    assertEquals(body.places[0]?.user_title, 'Belem Tower');
    assertEquals(body.places[0]?.id, 'place-1', 'place ids stay (legs + list keys need them)');
    assert(!('notes' in body.places[0]!), 'audit #12: place notes are private by default');
    assert(!('trip_id' in body.places[0]!), 'non-allow-listed column must be dropped');
    assert(Array.isArray(body.legs));
    assertEquals(body.legs.length, 0);
    // Least data fetched, too: the PostgREST select must not ask for them.
    const tripSelect = new URL(captured.tripsUrl!).searchParams.get('select') ?? '';
    const placeSelect = new URL(captured.placesUrl!).searchParams.get('select') ?? '';
    assert(!tripSelect.split(',').includes('id'), `trips select must not include id: ${tripSelect}`);
    assert(!tripSelect.includes('user_id'), `trips select must not include user_id: ${tripSelect}`);
    assert(!placeSelect.includes('notes'), `trip_places select must not include notes: ${placeSelect}`);
  } finally {
    mock.restore();
  }
});

D.test('op:read with default toggles: itinerary only; expenses + memories hidden and never queried', async () => {
  const captured = newCapture();
  // Legacy/pre-M5 row shape (no show_* columns) AND an explicit default row.
  for (const share of [{}, { show_itinerary: true, show_expenses: false, show_memories: false }]) {
    const mock = stubFetch(readRoutes(VALID_TRIP_ID, captured, share, { expenses: [{ amount: 1 }] }));
    try {
      const res = await handler(post({ op: 'read', token: 'validtoken12345678901234' }));
      assertEquals(res.status, 200);
      const body = (await res.json()) as ReadBody;
      assertEquals(body.sections, { itinerary: true, expenses: false, memories: false });
      assert(!('expenses' in body), 'expenses are hidden by default');
      assert(!('memories' in body), 'memories are hidden by default');
      assertEquals(touched(mock.calls, 'trip_expenses').length, 0, 'expenses never queried');
      for (const t of MEMORY_TABLES) assertEquals(touched(mock.calls, t).length, 0, `${t} never queried`);
      assert(!mock.calls.some((c) => c.url.includes('/storage/v1/')), 'nothing signed');
      const tripSelect = new URL(captured.tripsUrl!).searchParams.get('select') ?? '';
      assert(!tripSelect.includes('currency'), 'currency is only read for the expenses summary');
    } finally {
      mock.restore();
    }
  }
});

D.test('op:read with show_itinerary=false: places/legs are empty arrays (v2-safe), legs not queried', async () => {
  const mock = stubFetch(readRoutes(VALID_TRIP_ID, newCapture(), { show_itinerary: false }));
  try {
    const res = await handler(post({ op: 'read', token: 'validtoken12345678901234' }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as ReadBody;
    assertEquals(body.sections.itinerary, false);
    assertEquals(body.places, []);
    assertEquals(body.legs, []);
    assertEquals(body.trip.title, 'Shared Trip', 'the trip header stays');
    assertEquals(touched(mock.calls, 'trip_legs').length, 0);
    assertEquals(touched(mock.calls, 'trip_places').length, 0, 'no places needed without itinerary/memories');
  } finally {
    mock.restore();
  }
});

D.test('op:read with show_expenses: summary only (home totals + per-currency), never line items', async () => {
  const captured = newCapture();
  const expenses = [
    // TRY = home: x1
    { id: 'e1', category: 'food', kind: 'actual', amount: 100, currency: 'TRY', fx_rate: null, fx_date: null, fx_home_currency: null, label: 'PRIVATE dinner with Ayse' },
    // Frozen rate into the current home: x fx_rate
    { id: 'e2', category: 'food', kind: 'actual', amount: 10, currency: 'EUR', fx_rate: 35, fx_date: '2026-06-01', fx_home_currency: 'TRY', label: 'x' },
    // Frozen into a FORMER home (USD) -> recompute from fx_rates on fx_date
    { id: 'e3', category: 'transport', kind: 'estimated', amount: 20, currency: 'EUR', fx_rate: 1.1, fx_date: '2026-06-02', fx_home_currency: 'USD', label: 'x' },
    // No rate at all -> pending, reported per original currency
    { id: 'e4', category: 'shopping', kind: 'actual', amount: 50, currency: 'GBP', fx_rate: null, fx_date: null, fx_home_currency: null, label: 'x' },
    // Legacy NULL currency = home at rate 1
    { id: 'e5', category: 'other', kind: 'estimated', amount: 5, currency: null, fx_rate: null, fx_date: null, fx_home_currency: null, label: 'x' },
  ];
  const fxRates = [{ quote: 'TRY', rate_date: '2026-06-02', rate: 36 }];
  const mock = stubFetch(readRoutes(VALID_TRIP_ID, captured, { show_expenses: true }, { expenses, fxRates }));
  try {
    const res = await handler(post({ op: 'read', token: 'validtoken12345678901234' }));
    assertEquals(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text) as ReadBody;
    assertEquals(body.sections.expenses, true);
    assert(!('memories' in body), 'memories stay hidden');
    assertEquals(body.expenses, {
      homeCurrency: 'TRY',
      count: 5,
      totals: { actual: 450, estimated: 725 },
      byCategory: [
        { category: 'transport', actual: 0, estimated: 720 },
        { category: 'food', actual: 450, estimated: 0 },
        { category: 'other', actual: 0, estimated: 5 },
      ],
      byCurrency: [
        { currency: 'EUR', actual: 10, estimated: 20, count: 2 },
        { currency: 'TRY', actual: 100, estimated: 5, count: 2 },
        { currency: 'GBP', actual: 50, estimated: 0, count: 1 },
      ],
      pending: { count: 1, actualByCurrency: { GBP: 50 }, estimatedByCurrency: {} },
    });
    assert(!text.includes('PRIVATE dinner'), 'labels never leave the server');
    const select = new URL(captured.expensesUrls[0]!).searchParams.get('select') ?? '';
    assert(!select.includes('label'), `labels are not even fetched: ${select}`);
    assert(/deleted=eq\.false/.test(captured.expensesUrls[0]!), 'tombstones excluded');
    assert(!('currency' in body.trip), 'the trip allow-list is unchanged');
  } finally {
    mock.restore();
  }
});

D.test('op:read — ONLY_ME NEVER PUBLIC: memories carry shared, live, ready rows only', async () => {
  const captured = newCapture();
  const mock = stubFetch(readRoutes(VALID_TRIP_ID, captured, { show_memories: true }));
  try {
    const res = await handler(post({ op: 'read', token: 'validtoken12345678901234' }));
    assertEquals(res.status, 200);
    const text = await res.text();
    const body = JSON.parse(text) as ReadBody;
    assertEquals(body.sections.memories, true);
    const m = body.memories!;

    // 1. The query itself filters (least data fetched).
    for (const u of [captured.journalUrl!, captured.reviewsUrl!, captured.photosUrl!]) {
      assert(/visibility=eq\.trip/.test(u), `visibility filter missing: ${u}`);
      assert(/deleted=eq\.false/.test(u), `tombstone filter missing: ${u}`);
      assert(u.includes(`trip_id=eq.${VALID_TRIP_ID}`), `trip scope missing: ${u}`);
    }
    assert(/status=eq\.ready/.test(captured.photosUrl!), 'photos must be ready');
    // Owner-authored only (collaborators' shared items are for members).
    for (const u of [captured.journalUrl!, captured.reviewsUrl!, captured.photosUrl!]) {
      assert(u.includes(`author_id=eq.${OWNER_ID}`), `owner-author filter missing: ${u}`);
    }
    // Row caps keep the NEWEST journal/photos (fetched desc).
    assert(/order=day_index\.desc/.test(captured.journalUrl!), captured.journalUrl!);
    assert(/order=day_index\.desc/.test(captured.photosUrl!), captured.photosUrl!);

    // 2. …and the payload re-checks every row (the mock ignored the filter).
    assertEquals(m.journal.map((j) => j.id), ['j-shared']);
    assertEquals(m.reviews.map((r) => r.id).sort(), ['r-detached', 'r-linked']);
    assertEquals(m.photos.map((p) => p.id), ['ph-shared']);
    for (const secret of ['SECRET', 'COLLAB', 'j-private', 'r-private', 'ph-private', 'ph-pending', 'j-deleted', 'j-collab', 'r-collab', 'ph-collab', COLLAB_AUTHOR]) {
      assert(!text.includes(secret), `${secret} leaked into the public payload`);
    }
    // (The author uuid is inherent in the signed Storage PATH of a photo, but
    // it is never a payload field or value of its own.)
    assert(!text.includes('author_id') && !text.includes(`"${AUTHOR}"`), 'no author ids as fields');

    // 3. Private photos are never even signed; v4: thumbnails only.
    assertEquals(captured.signBodies.length, 1);
    assertEquals(captured.signBodies[0]!.expiresIn, 3600, '1 h signed URLs');
    assertEquals(captured.signBodies[0]!.paths, [photoPath('ph-shared', true)], 'a read signs thumbnails only');
    assert(!captured.signBodies[0]!.paths.some((p) => p.includes(COLLAB_AUTHOR)), 'a collaborator photo is never signed');
    const photo = m.photos[0]!;
    assert(String(photo.url).startsWith('http://127.0.0.1:54321/storage/v1/object/sign/trip-memories/'), String(photo.url));
    assert(String(photo.thumbUrl).includes('_t.jpg'), 'thumb URL signs the thumb object');
    assertEquals(photo.url, photo.thumbUrl, 'v4: `url` is the thumbnail too (full size via photo_url)');
    assertEquals(photo.placeId, 'place-1');
    assert(m.photoUrlExpiresAt && Date.parse(m.photoUrlExpiresAt) > Date.now());
    assertEquals(m.truncated, false);
  } finally {
    mock.restore();
  }
});

D.test('op:read memories: a review whose place was removed shows the 0038 snapshot name', async () => {
  const mock = stubFetch(readRoutes(VALID_TRIP_ID, newCapture(), { show_memories: true }));
  try {
    const body = (await (await handler(post({ op: 'read', token: 'validtoken12345678901234' }))).json()) as ReadBody;
    const byId = Object.fromEntries(body.memories!.reviews.map((r) => [r.id, r]));
    assertEquals(byId['r-detached'], {
      id: 'r-detached',
      placeId: null,
      placeName: 'Removed Cafe',
      rating: 3,
      body: '',
      createdAt: '2026-06-02T12:00:00Z',
    });
    assertEquals(byId['r-linked']?.placeName, 'Belem Tower', 'a live place wins over a stale snapshot');
    assertEquals(byId['r-linked']?.placeId, 'place-1');
  } finally {
    mock.restore();
  }
});

D.test('op:read memories with the itinerary hidden: names kept, place ids not exposed', async () => {
  const mock = stubFetch(readRoutes(VALID_TRIP_ID, newCapture(), { show_itinerary: false, show_memories: true }));
  try {
    const body = (await (await handler(post({ op: 'read', token: 'validtoken12345678901234' }))).json()) as ReadBody;
    assertEquals(body.places, []);
    const linked = body.memories!.reviews.find((r) => r.id === 'r-linked')!;
    assertEquals(linked.placeName, 'Belem Tower');
    assertEquals(linked.placeId, null, 'ids only point into a visible itinerary');
    assertEquals(body.memories!.photos[0]!.placeId, null);
  } finally {
    mock.restore();
  }
});

D.test('op:read memories toggle OFF: memory tables are never read even when shared items exist', async () => {
  const mock = stubFetch(readRoutes(VALID_TRIP_ID, newCapture(), { show_memories: false, show_expenses: false }));
  try {
    const body = (await (await handler(post({ op: 'read', token: 'validtoken12345678901234' }))).json()) as ReadBody;
    assert(!('memories' in body));
    for (const t of MEMORY_TABLES) assertEquals(touched(mock.calls, t).length, 0);
  } finally {
    mock.restore();
  }
});

D.test('op:read memories: a Storage signing failure hides photos, the page still loads', async () => {
  const base = readRoutes(VALID_TRIP_ID, newCapture(), { show_memories: true });
  const mock = stubFetch((url, method, init) =>
    url.includes('/storage/v1/object/sign/') ? json({ statusCode: '500', error: 'boom', message: 'boom' }, 500) : base(url, method, init));
  try {
    const res = await handler(post({ op: 'read', token: 'validtoken12345678901234' }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as ReadBody;
    assertEquals(body.memories!.photos, []);
    assertEquals(body.memories!.photoUrlExpiresAt, null);
    assertEquals(body.memories!.journal.length, 1);
  } finally {
    mock.restore();
  }
});

D.test('op:read memories: photo URLs are exactly the Storage-signed URLs (absolute, private bucket)', async () => {
  const mock = stubFetch(readRoutes(VALID_TRIP_ID, newCapture(), { show_memories: true }));
  try {
    const body = (await (await handler(post({ op: 'read', token: 'validtoken12345678901234' }))).json()) as ReadBody;
    const p = body.memories!.photos[0]!;
    const path = photoPath('ph-shared', true);
    assertEquals(
      p.thumbUrl,
      `http://127.0.0.1:54321/storage/v1/object/sign/trip-memories/${path}?token=sig-${path.length}`,
    );
    assertEquals(p.url, p.thumbUrl);
    assert(!String(p.url).includes('/object/public/'), 'never a public-bucket URL');
  } finally {
    mock.restore();
  }
});

D.test('op:read filters trip_legs older than 30 days via computed_at cutoff', async () => {
  // Regression test for the Phase 4 ToS fix: legs whose `computed_at` is
  // older than 30 days must NOT be returned from the public share endpoint.
  // The handler appends `.gte('computed_at', <cutoff>)` to the legs query;
  // PostgREST surfaces that as `computed_at=gte.<iso>`. We simulate PostgREST
  // honoring the filter by returning only the fresh leg, and assert the
  // handler pushed a ~30-day cutoff down.
  const TRIP_ID = '00000000-0000-4000-8000-0000000000aa';
  const freshLeg = {
    id: 'leg-fresh',
    from_place_id: 'p1',
    to_place_id: 'p2',
    day_index: 0,
    transport_mode: 'driving',
    duration_seconds: 1200,
    distance_meters: 15000,
    polyline: 'abcdef',
    computed_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  };
  let capturedLegsUrl = '';
  const invokedAt = Date.now();
  const base = readRoutes(TRIP_ID, {});
  const mock = stubFetch((url, method, init) => {
    if (url.includes('/trip_legs')) {
      capturedLegsUrl = url;
      return json([freshLeg]);
    }
    if (url.includes('/trip_places')) return json([{ id: 'p1' }, { id: 'p2' }]);
    return base(url, method, init);
  });
  try {
    const res = await handler(post({ op: 'read', token: 'ttltoken1234567890123456' }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { legs: Array<{ id: string; computed_at: string }> };
    assertEquals(body.legs.length, 1, 'only the fresh leg should be returned');
    assertEquals(body.legs[0]?.id, 'leg-fresh');

    assert(/computed_at=gte\./.test(capturedLegsUrl), `trip_legs URL must gte-filter computed_at: ${capturedLegsUrl}`);
    assert(/day_index=gte\.0/.test(capturedLegsUrl), `day legs only (no matrix-cache rows): ${capturedLegsUrl}`);
    const match = capturedLegsUrl.match(/computed_at=gte\.([^&]+)/);
    assert(match && match[1], 'failed to extract cutoff timestamp from URL');
    const cutoffMs = Date.parse(decodeURIComponent(match![1]!));
    assert(!Number.isNaN(cutoffMs), 'cutoff must be a valid ISO timestamp');
    const expectedCutoff = invokedAt - 30 * 24 * 60 * 60 * 1000;
    assert(Math.abs(cutoffMs - expectedCutoff) <= 10_000, 'cutoff must be within 10s of now() - 30d');
  } finally {
    mock.restore();
  }
});

// ---- public-fields.ts (pure) ------------------------------------------------

D.test('public-fields: allow-lists exclude private keys and drive the select strings', () => {
  assertEquals(SHARE_READ_CONTRACT_VERSION, 4);
  for (const k of FORBIDDEN_PUBLIC_KEYS) {
    assert(!(PUBLIC_TRIP_KEYS as readonly string[]).includes(k), `trip allow-list must not have ${k}`);
    assert(!(PUBLIC_PLACE_KEYS as readonly string[]).includes(k), `place allow-list must not have ${k}`);
  }
  assert(!(PUBLIC_TRIP_KEYS as readonly string[]).includes('id'), 'trip allow-list must not have id');
  assertEquals(TRIP_FIELDS, PUBLIC_TRIP_KEYS.join(', '));
  assertEquals(PLACE_FIELDS, PUBLIC_PLACE_KEYS.join(', '));
  assert(LEG_FIELDS.includes('computed_at'));
  assert(LEG_FIELDS.split(', ').includes('source'), 'v3 additive: legs carry source (estimate marker)');
});

D.test('public-fields: legs to a removed / unknown place are never public (no route to a deleted stop)', () => {
  const out = buildPublicSharePayload({
    trip: { title: 'T' },
    places: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3', deleted: true }],
    legs: [
      { id: 'ok', from_place_id: 'p1', to_place_id: 'p2', source: 'ors' },
      { id: 'to-deleted', from_place_id: 'p2', to_place_id: 'p3' },
      { id: 'to-gone', from_place_id: 'p1', to_place_id: 'home-gone' },
      { id: 'no-ends' },
    ],
  });
  assertEquals(out.legs, [{ id: 'ok', from_place_id: 'p1', to_place_id: 'p2', source: 'ors' }]);
});

D.test('op:read drops legs whose endpoints are not live public places', async () => {
  const base = readRoutes(VALID_TRIP_ID, newCapture());
  const mock = stubFetch((url, method, init) => {
    if (url.includes('/trip_legs')) {
      return json([
        { id: 'leg-ok', from_place_id: 'place-1', to_place_id: 'place-1', computed_at: new Date().toISOString() },
        { id: 'leg-stale', from_place_id: 'place-1', to_place_id: 'deleted-home', polyline: 'HOME', computed_at: new Date().toISOString() },
      ]);
    }
    return base(url, method, init);
  });
  try {
    const res = await handler(post({ op: 'read', token: 'validtoken12345678901234' }));
    const text = await res.text();
    assertEquals((JSON.parse(text) as ReadBody).legs.map((l) => (l as { id: string }).id), ['leg-ok']);
    assert(!text.includes('deleted-home') && !text.includes('HOME'));
  } finally {
    mock.restore();
  }
});

D.test('public-fields: buildPublicSharePayload strips everything off-list', () => {
  const out = buildPublicSharePayload({
    trip: { id: 't', user_id: 'u', title: 'T', notes: 'x', start_date: null },
    places: [{ id: 'p', notes: 'secret', user_title: 'A', lat: 1, lng: 2 }],
    legs: null,
  });
  assertEquals(out.trip, { title: 'T', start_date: null });
  assertEquals(out.places, [{ id: 'p', user_title: 'A', lat: 1, lng: 2 }]);
  assertEquals(out.legs, []);
  assertEquals(out.sections, { itinerary: true, expenses: false, memories: false });
  assertEquals(out.meta, { contractVersion: 4 });
});

D.test('public-fields: a section is emitted only when its toggle is on (data passed by mistake is dropped)', () => {
  const memories = { journal: [], reviews: [], photos: [], photoUrlExpiresAt: null, truncated: false };
  const off = buildPublicSharePayload({
    trip: { title: 'T' },
    places: [{ id: 'p' }],
    legs: [{ id: 'l' }],
    settings: { showItinerary: false, showExpenses: false, showMemories: false },
    expenses: { count: 1 },
    memories,
  });
  assertEquals(off.places, []);
  assertEquals(off.legs, []);
  assert(!('expenses' in off) && !('memories' in off));
  const on = buildPublicSharePayload({
    trip: {},
    places: [],
    legs: [],
    settings: { showItinerary: true, showExpenses: true, showMemories: true },
    expenses: { count: 1 },
    memories,
  });
  assertEquals(on.expenses, { count: 1 });
  assertEquals(on.memories, memories);
});

D.test('public-fields: settings parse FAIL-CLOSED and map to columns', () => {
  assertEquals(settingsFromRow({}), DEFAULT_SHARE_SETTINGS);
  assertEquals(settingsFromRow({ show_itinerary: null, show_expenses: 'true', show_memories: 1 }), DEFAULT_SHARE_SETTINGS);
  assertEquals(settingsFromRow({ show_itinerary: false, show_expenses: true, show_memories: true }), {
    showItinerary: false,
    showExpenses: true,
    showMemories: true,
  });
  assertEquals(settingsToColumns({ showMemories: true }), { show_memories: true });
  assertEquals(settingsToColumns({}), {});
});

D.test('public-fields: isPublicMemoryRow — only_me / deleted / pending / missing columns are private', () => {
  const o = { author_id: OWNER_ID };
  assert(isPublicMemoryRow({ ...o, visibility: 'trip', deleted: false }, 'journal', OWNER_ID));
  assert(!isPublicMemoryRow({ ...o, visibility: 'only_me', deleted: false }, 'journal', OWNER_ID));
  assert(!isPublicMemoryRow({ ...o, visibility: 'trip', deleted: true }, 'review', OWNER_ID));
  assert(!isPublicMemoryRow({ ...o, visibility: 'trip' }, 'review', OWNER_ID), 'missing deleted = private');
  assert(!isPublicMemoryRow({ ...o, deleted: false }, 'review', OWNER_ID), 'missing visibility = private');
  assert(!isPublicMemoryRow({ ...o, visibility: 'trip', deleted: false, status: 'pending' }, 'photo', OWNER_ID));
  assert(isPublicMemoryRow({ ...o, visibility: 'trip', deleted: false, status: 'ready' }, 'photo', OWNER_ID));
  // Owner-authored only; a missing owner id or author id fails closed.
  assert(!isPublicMemoryRow({ author_id: COLLAB_AUTHOR, visibility: 'trip', deleted: false }, 'journal', OWNER_ID));
  assert(!isPublicMemoryRow({ visibility: 'trip', deleted: false }, 'journal', OWNER_ID), 'missing author = private');
  assert(!isPublicMemoryRow({ ...o, visibility: 'trip', deleted: false }, 'journal', null), 'no owner = private');
  // v4: thumbnails only (full size via op photo_url).
  assertEquals(photoPathsToSign(PHOTO_ROWS, OWNER_ID), [photoPath('ph-shared', true)]);
  assertEquals(photoPathsToSign(PHOTO_ROWS, null), []);
});

D.test('public-fields: buildPublicMemories drops unsigned photos and empty items', () => {
  const out = buildPublicMemories({
    journal: JOURNAL_ROWS,
    reviews: [...REVIEW_ROWS, { id: 'r-empty', trip_place_id: null, rating: null, body: ' ', visibility: 'trip', deleted: false }],
    photos: PHOTO_ROWS,
    places: [],
    publicPlaceIds: new Set(),
    ownerId: OWNER_ID,
    signed: new Map([[photoPath('ph-shared'), 'u']]), // thumb missing
    photoUrlExpiresAt: '2030-01-01T00:00:00Z',
    truncated: false,
  });
  assertEquals(out.journal.map((j: { id: string }) => j.id), ['j-shared']);
  assert(!out.reviews.some((r: { id: string }) => r.id === 'r-empty'));
  assertEquals(out.photos, []);
  assertEquals(out.photoUrlExpiresAt, null);
});

// ---- expense-summary.ts (pure) ------------------------------------------------

D.test('expense-summary: conversion order matches the 0038 MV (x1, frozen, fx_rates, pending)', () => {
  const rates = new Map([[rateKey('2026-06-02', 'TRY'), 36], [rateKey('2026-06-02', 'USD'), 1.08]]);
  assertEquals(homeRate({ currency: null }, 'TRY', rates), 1);
  assertEquals(homeRate({ currency: 'TRY' }, 'TRY', rates), 1);
  assertEquals(homeRate({ currency: 'EUR', fx_rate: 35, fx_home_currency: 'TRY' }, 'TRY', rates), 35);
  // Frozen into another home: never used; recompute from fx_rates.
  assertEquals(homeRate({ currency: 'EUR', fx_rate: 1.1, fx_home_currency: 'USD', fx_date: '2026-06-02' }, 'TRY', rates), 36);
  // Cross rate via EUR: USD -> TRY = 36 / 1.08.
  assertEquals(homeRate({ currency: 'USD', fx_date: '2026-06-02' }, 'TRY', rates), 36 / 1.08);
  // Home EUR: rate(EUR) = 1.
  assertEquals(homeRate({ currency: 'TRY', fx_date: '2026-06-02' }, 'EUR', rates), 1 / 36);
  // A missing leg or no date -> pending, never 1:1.
  assertEquals(homeRate({ currency: 'GBP', fx_date: '2026-06-02' }, 'TRY', rates), null);
  assertEquals(homeRate({ currency: 'GBP', fx_rate: 40, fx_home_currency: 'USD' }, 'TRY', rates), null);
});

D.test('expense-summary: rateLookupsNeeded asks only for rows that reach rule 3', () => {
  const need = rateLookupsNeeded(
    [
      { currency: 'TRY' },
      { currency: 'EUR', fx_rate: 35, fx_home_currency: 'TRY', fx_date: '2026-06-01' },
      { currency: 'USD', fx_date: '2026-06-03T00:00:00Z' },
      { currency: 'EUR', fx_rate: 1, fx_home_currency: 'USD', fx_date: '2026-06-02' },
      { currency: 'GBP' },
    ],
    'TRY',
  );
  assertEquals(need, { dates: ['2026-06-02', '2026-06-03'], quotes: ['TRY', 'USD'] });
  assertEquals(rateLookupsNeeded([{ currency: 'TRY' }], 'TRY'), { dates: [], quotes: [] });
});

D.test('expense-summary: bad rows are ignored, float noise trimmed', () => {
  const s = summarizeExpenses(
    [
      { category: 'food', kind: 'actual', amount: 0.1, currency: 'EUR' },
      { category: 'food', kind: 'actual', amount: '0.2', currency: 'EUR' },
      { category: 'food', kind: 'actual', amount: 'abc', currency: 'EUR' },
      { category: 'food', kind: 'actual', amount: -5, currency: 'EUR' },
    ],
    'EUR',
    new Map(),
  );
  assertEquals(s.count, 2);
  assertEquals(s.totals.actual, 0.3);
  assertEquals(s.byCurrency, [{ currency: 'EUR', actual: 0.3, estimated: 0, count: 2 }]);
});

// ---- op: revoke --------------------------------------------------------------

/** Revoke fixture: owner lookup → PATCH trip_shares → count (content-range). */
function revokeRoutes(ownerId: string) {
  return (url: string, method: string): Response | undefined => {
    const trips = tripsRow(ownerId)(url);
    if (trips) return trips;
    if (url.includes('/trip_shares') && method === 'PATCH') return json(null, 204);
    if (url.includes('/trip_shares')) return json([], 200, { 'content-range': '0-0/1' });
    return undefined;
  };
}

D.test('op:revoke by the OWNER revokes and returns { revoked }', async () => {
  const mock = stubFetch(revokeRoutes(OWNER_ID));
  try {
    const res = await handler(post({ op: 'revoke', tripId: VALID_TRIP_ID }, OWNER_JWT));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { revoked: number };
    assertEquals(body.revoked, 1);
    assertEquals(sharesWrites(mock.calls).length, 1, 'exactly one trip_shares PATCH');
  } finally {
    mock.restore();
  }
});

D.test('audit #5: op:revoke by an accepted VIEWER → 403 not_owner, links untouched', async () => {
  const mock = stubFetch(revokeRoutes(OWNER_ID));
  try {
    const res = await handler(
      post({ op: 'revoke', tripId: VALID_TRIP_ID, token: 'owner-token-value-1234567' }, VIEWER_JWT),
    );
    assertEquals(res.status, 403);
    assertEquals(((await res.json()) as ErrBody).error.code, 'not_owner');
    assertEquals(sharesWrites(mock.calls).length, 0, 'no PATCH on trip_shares for a viewer');
  } finally {
    mock.restore();
  }
});

D.test('audit #5: op:revoke by an accepted EDITOR → 403 not_owner', async () => {
  const mock = stubFetch(revokeRoutes(OWNER_ID));
  try {
    const res = await handler(post({ op: 'revoke', tripId: VALID_TRIP_ID }, EDITOR_JWT));
    assertEquals(res.status, 403);
    assertEquals(sharesWrites(mock.calls).length, 0);
  } finally {
    mock.restore();
  }
});

D.test('op:revoke without auth → 401 not_authenticated', async () => {
  const mock = stubFetch(() => undefined);
  try {
    const res = await handler(post({ op: 'revoke', tripId: VALID_TRIP_ID }));
    assertEquals(res.status, 401);
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

// ---- gap #8: CORS deny (Step 5.2) ----------------------------------------
// _shared/cors.ts fails closed when ALLOWED_ORIGINS does not include the
// caller's origin. Regression guard for Phase 1 Problem 1 fix.

D.test('CORS deny: disallowed origin is not echoed in response', async () => {
  D.env.set('ALLOWED_ORIGINS', 'http://localhost:8081,https://tripvisor.app');

  const res = await handler(new Request('http://localhost/?ping=1', {
    headers: { origin: 'https://evil.example' },
  }));
  assertEquals(res.status, 200);
  const acao = res.headers.get('Access-Control-Allow-Origin');
  assert(
    acao !== 'https://evil.example',
    `CORS must not echo disallowed origin; got: ${acao}`,
  );
  // Reset for subsequent tests
  D.env.set('ALLOWED_ORIGINS', '*');
});

// ---- gap #18: revoke-then-create idempotence (Step 5.2) ------------------
// Create a share → revoke it → create a new share → assert:
//   1. The second token is distinct from the first.
//   2. Reading the first (revoked) token returns 404.
//   3. Reading the second token returns the trip.

D.test('revoke-then-create idempotence: second token is distinct; first is 404', async () => {
  // --- STEP 1: create first share ---
  let mock = stubFetch(createRoutes(OWNER_ID));
  const res1 = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, OWNER_JWT));
  mock.restore();
  assertEquals(res1.status, 200);
  const token1 = ((await res1.json()) as { token: string }).token;
  assert(token1.length >= 20, 'First token must be a non-trivial string');

  // --- STEP 2: revoke first share ---
  mock = stubFetch(revokeRoutes(OWNER_ID));
  const res2 = await handler(post({ op: 'revoke', tripId: VALID_TRIP_ID }, OWNER_JWT));
  mock.restore();
  assertEquals(res2.status, 200);

  // --- STEP 3: create second share ---
  mock = stubFetch(createRoutes(OWNER_ID));
  const res3 = await handler(post({ op: 'create', tripId: VALID_TRIP_ID }, OWNER_JWT));
  mock.restore();
  assertEquals(res3.status, 200);
  const token2 = ((await res3.json()) as { token: string }).token;
  assert(token1 !== token2, `Second token must differ from first; both are: ${token1}`);

  // --- STEP 4: reading the revoked (first) token → 404 ---
  mock = stubFetch((url) =>
    url.includes('/trip_shares') ? json({ trip_id: VALID_TRIP_ID, revoked_at: new Date().toISOString() }) : undefined);
  const res4 = await handler(post({ op: 'read', token: token1 }));
  mock.restore();
  assertEquals(res4.status, 404, 'Revoked first token must return 404');

  // --- STEP 5: reading the second (active) token → trip data ---
  mock = stubFetch(readRoutes(VALID_TRIP_ID, {}));
  const res5 = await handler(post({ op: 'read', token: token2 }));
  mock.restore();
  assertEquals(res5.status, 200, 'Second (active) token must return 200');
  const body5 = (await res5.json()) as { trip: Record<string, unknown> };
  assertEquals(body5.trip.title, 'Shared Trip');
});

// ---- Wave-2 sweep: rate limits, meta, photo_url -------------------------------

function anonPost(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const DB_KEY = /^[a-z]{1,8}:[A-Za-z0-9_-]{1,64}$/; // 0040 share_read_counters.key CHECK

D.test('rate-limit: client IP = first x-forwarded-for hop, IPv6 cut to /64, garbage -> unknown', () => {
  assertEquals(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })), '203.0.113.7');
  assertEquals(clientIp(new Headers({ 'x-forwarded-for': 'nonsense', 'cf-connecting-ip': '198.51.100.2' })), '198.51.100.2');
  assertEquals(clientIp(new Headers({ 'x-real-ip': '198.51.100.3:4431' })), '198.51.100.3');
  assertEquals(clientIp(new Headers()), 'unknown');
  assertEquals(normaliseIp('2001:db8:85a3:1:2:8a2e:370:7334'), '2001:db8:85a3:1::/64');
  assertEquals(normaliseIp('2001:DB8:85A3:0001::1'), '2001:db8:85a3:1::/64', 'same /64, same bucket');
  assertEquals(normaliseIp('[2001:db8::1]:443'), '2001:db8:0:0::/64');
  assertEquals(normaliseIp('::ffff:192.0.2.9'), '192.0.2.9');
  assertEquals(normaliseIp('999.1.1.1'), null);
  assertEquals(normaliseIp('1:2:3'), null);
});

D.test('rate-limit: keys fit the 0040 CHECK and never contain the token or the raw IP', async () => {
  for (const kind of ['read', 'photo_url', 'meta'] as const) {
    const k = await rateKeys(kind, SHARE_ROW_ID, '203.0.113.7', 'secret-a');
    assert(DB_KEY.test(k.tokenKey), k.tokenKey);
    assert(k.tokenKey.endsWith(SHARE_ROW_ID), 'per link = the share row id');
    if (SHARE_RATE_LIMITS[kind].ipCap === null) {
      assertEquals(k.ipKey, null, `${kind} has no IP limit`);
    } else {
      assert(k.ipKey && DB_KEY.test(k.ipKey), String(k.ipKey));
      assert(!k.ipKey!.includes('203'), 'the raw IP is never stored');
      const other = await rateKeys(kind, SHARE_ROW_ID, '203.0.113.7', 'secret-b');
      assert(other.ipKey !== k.ipKey, 'keyed by a secret (not a plain hash)');
    }
  }
  assertEquals(SHARE_RATE_LIMITS.read.tokenCap, 300);
  assertEquals(SHARE_RATE_LIMITS.read.ipCap, 60);
});

D.test('op:read counts the link (per day) and the caller IP (per hour) before reading anything', async () => {
  const captured = newCapture();
  const mock = stubFetch(readRoutes(VALID_TRIP_ID, captured));
  try {
    const a = await handler(anonPost({ op: 'read', token: 'validtoken12345678901234' }, { 'x-forwarded-for': '203.0.113.7, 10.1.1.1' }));
    assertEquals(a.status, 200);
    await a.body?.cancel();
    const b = await handler(anonPost({ op: 'read', token: 'validtoken12345678901234' }, { 'x-forwarded-for': '203.0.113.7' }));
    await b.body?.cancel();
    const c = await handler(anonPost({ op: 'read', token: 'validtoken12345678901234' }, { 'x-forwarded-for': '198.51.100.9' }));
    await c.body?.cancel();
    assertEquals(captured.rateCalls.length, 3);
    const [r1, r2, r3] = captured.rateCalls;
    assertEquals(r1!.p_token_key, `rt:${SHARE_ROW_ID}`);
    assertEquals([r1!.p_token_cap, r1!.p_ip_cap], [300, 60]);
    assertEquals(r1!.p_ip_key, r2!.p_ip_key, 'same first hop, same IP bucket');
    assert(r1!.p_ip_key !== r3!.p_ip_key, 'another IP, another bucket');
    assert(!JSON.stringify(captured.rateCalls).includes('validtoken'), 'no token material in counter keys');
    // The counter runs before the trip is read.
    const rpcIdx = mock.calls.findIndex((x) => x.url.includes('/rpc/consume_share_read'));
    const tripIdx = mock.calls.findIndex((x) => /\/rest\/v1\/trips\b/.test(x.url));
    assert(rpcIdx >= 0 && rpcIdx < tripIdx);
  } finally {
    mock.restore();
  }
});

D.test('op:read over a cap -> 429 rate_limited + Retry-After; no trip data read, nothing signed', async () => {
  const captured = newCapture();
  const mock = stubFetch(
    readRoutes(VALID_TRIP_ID, captured, { show_memories: true }, { rate: { allowed: false, scope: 'ip', retry_after: 1234 } }),
  );
  try {
    const res = await handler(anonPost({ op: 'read', token: 'validtoken12345678901234' }, { origin: 'http://localhost:8081' }));
    assertEquals(res.status, 429);
    assertEquals(res.headers.get('Retry-After'), '1234');
    assert((res.headers.get('Access-Control-Expose-Headers') ?? '').includes('Retry-After'), 'browsers may read it');
    const body = (await res.json()) as { error: { code: string }; retryAfterSeconds: number; scope: string };
    assertEquals([body.error.code, body.retryAfterSeconds, body.scope], ['rate_limited', 1234, 'ip']);
    for (const t of ['trips', 'trip_places', 'trip_legs', ...MEMORY_TABLES]) assertEquals(touched(mock.calls, t).length, 0, t);
    assert(!mock.calls.some((x) => x.url.includes('/storage/v1/')));
  } finally {
    mock.restore();
  }
});

D.test('op:read with the counter down -> 503 rate_limit_unavailable (fails closed)', async () => {
  const mock = stubFetch(readRoutes(VALID_TRIP_ID, newCapture(), {}, { rate: { message: 'boom' }, rateStatus: 500 }));
  try {
    const res = await handler(anonPost({ op: 'read', token: 'validtoken12345678901234' }));
    assertEquals(res.status, 503);
    assertEquals(((await res.json()) as ErrBody).error.code, 'rate_limit_unavailable');
    assertEquals(touched(mock.calls, 'trips').length, 0);
  } finally {
    mock.restore();
  }
});

D.test('an unknown token never creates a counter row (404 before counting)', async () => {
  const mock = stubFetch((url) => (url.includes('/trip_shares') ? json([]) : undefined));
  try {
    for (const op of ['read', 'meta'] as const) {
      const res = await handler(anonPost({ op, token: 'nonexistent-token-value-1234567' }));
      assertEquals(res.status, 404);
      await res.body?.cancel();
    }
    assert(!mock.calls.some((x) => x.url.includes('consume_share_read')));
  } finally {
    mock.restore();
  }
});

D.test('op:meta: title + dates + place count only (no memories, no legs, no signing), link-only limit', async () => {
  const captured = newCapture();
  const base = readRoutes(VALID_TRIP_ID, captured, { show_memories: true, show_expenses: true });
  const placesReqs: Call[] = [];
  const mock = stubFetch((url, method, init) => {
    if (url.includes('/trip_places')) {
      placesReqs.push({ url, method, body: null });
      return new Response(null, { status: 200, headers: { 'content-range': '*/3' } });
    }
    return base(url, method, init);
  });
  try {
    const res = await handler(anonPost({ op: 'meta', token: 'validtoken12345678901234' }, { 'x-forwarded-for': '203.0.113.7' }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assertEquals(body, {
      trip: { title: 'Shared Trip', start_date: '2026-06-01', end_date: '2026-06-03' },
      placeCount: 3,
      meta: { contractVersion: 4 },
    });
    assertEquals(captured.rateCalls[0], { p_token_key: `mt:${SHARE_ROW_ID}`, p_ip_key: null, p_token_cap: 200, p_ip_cap: null });
    assert(placesReqs.length === 1 && placesReqs[0]!.method === 'HEAD', 'places are counted, not fetched');
    assert(/deleted=eq\.false/.test(placesReqs[0]!.url), 'tombstones are not counted');
    const tripSelect = new URL(captured.tripsUrl!).searchParams.get('select') ?? '';
    assertEquals(tripSelect.split(',').map((s) => s.trim()).sort(), ['end_date', 'start_date', 'title']);
    for (const t of ['trip_legs', 'trip_expenses', ...MEMORY_TABLES]) assertEquals(touched(mock.calls, t).length, 0, t);
    assert(!mock.calls.some((x) => x.url.includes('/storage/v1/')));
  } finally {
    mock.restore();
  }
});

D.test('op:meta with the itinerary hidden: placeCount 0, places never queried', async () => {
  const mock = stubFetch(readRoutes(VALID_TRIP_ID, newCapture(), { show_itinerary: false }));
  try {
    const body = (await (await handler(anonPost({ op: 'meta', token: 'validtoken12345678901234' }))).json()) as {
      placeCount: number;
    };
    assertEquals(body.placeCount, 0);
    assertEquals(touched(mock.calls, 'trip_places').length, 0);
  } finally {
    mock.restore();
  }
});

const PHOTO_UUID = '77777777-7777-4777-8777-000000000001';

function photoUrlRoutes(photo: Record<string, unknown> | null, share: Record<string, unknown> = { show_memories: true }) {
  const captured = newCapture();
  const signed: string[] = [];
  let photoUrl = '';
  const base = readRoutes(VALID_TRIP_ID, captured, share);
  const route = (url: string, method: string, init?: RequestInit): Response | undefined => {
    if (url.includes('/trip_photos')) {
      photoUrl = url;
      return json(photo ? [photo] : []);
    }
    const single = /\/storage\/v1\/object\/sign\/trip-memories\/(.+)$/.exec(url);
    if (single && method === 'POST') {
      const path = decodeURIComponent(single[1]!);
      signed.push(path);
      return json({ signedURL: `/object/sign/trip-memories/${path}?token=full` });
    }
    return base(url, method, init);
  };
  return { route, captured, signed, photoUrl: () => photoUrl };
}

const SHARED_PHOTO = {
  ...PHOTO_ROWS[0]!,
  id: PHOTO_UUID,
  storage_path: photoPath(PHOTO_UUID),
  thumb_path: photoPath(PHOTO_UUID, true),
};

D.test('op:photo_url signs ONE public full-size photo (1 h), rate limited per link + IP', async () => {
  const h = photoUrlRoutes(SHARED_PHOTO);
  const mock = stubFetch(h.route);
  try {
    const res = await handler(anonPost({ op: 'photo_url', token: 'validtoken12345678901234', photoId: PHOTO_UUID }));
    assertEquals(res.status, 200);
    const body = (await res.json()) as { url: string; expiresAt: string; meta: { contractVersion: number } };
    assertEquals(h.signed, [photoPath(PHOTO_UUID)], 'the full image, nothing else');
    assertEquals(body.url, `http://127.0.0.1:54321/storage/v1/object/sign/trip-memories/${photoPath(PHOTO_UUID)}?token=full`);
    assert(Date.parse(body.expiresAt) > Date.now() + 50 * 60 * 1000);
    assertEquals(body.meta.contractVersion, 4);
    const q = h.photoUrl();
    for (const f of [`id=eq.${PHOTO_UUID}`, `trip_id=eq.${VALID_TRIP_ID}`, `author_id=eq.${OWNER_ID}`, 'visibility=eq.trip', 'deleted=eq.false', 'status=eq.ready']) {
      assert(q.includes(f), `photo query must filter ${f}: ${q}`);
    }
    const rate = h.captured.rateCalls[0]!;
    assertEquals([rate.p_token_key, rate.p_token_cap, rate.p_ip_cap], [`pt:${SHARE_ROW_ID}`, 1000, 300]);
    assert(String(rate.p_ip_key).startsWith('pi:'));
  } finally {
    mock.restore();
  }
});

for (const [label, photo, share] of [
  ['an only_me photo (query filter bypassed)', { ...SHARED_PHOTO, visibility: 'only_me' }, { show_memories: true }],
  ['a collaborator\'s shared photo', { ...SHARED_PHOTO, author_id: '55555555-5555-4555-8555-000000000005' }, { show_memories: true }],
  ['a pending photo', { ...SHARED_PHOTO, status: 'pending' }, { show_memories: true }],
  ['an unknown photo', null, { show_memories: true }],
  ['any photo when the memories toggle is off', SHARED_PHOTO, { show_memories: false }],
] as const) {
  D.test(`op:photo_url: ${label} -> 404, nothing signed`, async () => {
    const h = photoUrlRoutes(photo as Record<string, unknown> | null, share);
    const mock = stubFetch(h.route);
    try {
      const res = await handler(anonPost({ op: 'photo_url', token: 'validtoken12345678901234', photoId: PHOTO_UUID }));
      assertEquals(res.status, 404);
      assertEquals(((await res.json()) as ErrBody).error.code, 'not_found');
      assertEquals(h.signed, []);
      assert(!mock.calls.some((x) => x.url.includes('/storage/v1/')));
    } finally {
      mock.restore();
    }
  });
}

D.test('op:photo_url validates its input (uuid photoId) before any network call', async () => {
  const mock = stubFetch(() => undefined);
  try {
    const res = await handler(anonPost({ op: 'photo_url', token: 'validtoken12345678901234', photoId: 'x' }));
    assertEquals(res.status, 400);
    await res.body?.cancel();
    assertEquals(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});
