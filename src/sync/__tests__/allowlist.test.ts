/**
 * C3 guard suite — the Tier-1 ToS firewall (v2 S2.3).
 *
 * The Legend-State SQLite store is a second persistence engine the TanStack
 * `shouldDehydrateQuery` allowlist does not govern; these tests are the
 * regression net keeping Google-restricted Place content out of it
 * (docs/v2/risks-and-decisions.md C3).
 */
import { describe, expect, it } from '@jest/globals';
import {
  TIER1_AUTHOR_SCOPED_TABLES,
  TIER1_FIELDS,
  TIER1_TABLES,
  TIER1_UPDATE_ONLY_TABLES,
  TIER1_USER_CONTENT_EXCEPTIONS,
  TIER1_WRITE_FIELDS,
  TIER1_WRITE_TABLES,
  SyncTosViolationError,
  isRestrictedFieldName,
  isTier1AuthorScopedTable,
  isTier1WriteTable,
  sanitizeForTier1,
  sanitizeForTier1Write,
  tier1SelectColumns,
  type Tier1Table,
  type Tier1WriteDropKind,
} from '../allowlist';

describe('sanitizeForTier1 — restricted Google content', () => {
  const RESTRICTED_SAMPLES = [
    'rating',
    'user_rating_count',
    'reviews',
    'photos',
    'photo_reference',
    'regular_opening_hours',
    'opening_hours',
    'national_phone_number',
    'website_uri',
    'formatted_address',
    'display_name',
    'editorial_summary',
    'author_attribution',
    'price_level',
  ];

  it.each(RESTRICTED_SAMPLES)('throws on restricted field "%s" (mode throw)', (field) => {
    expect(() =>
      sanitizeForTier1('trip_places', { id: 'x', [field]: 'evil' }),
    ).toThrow(SyncTosViolationError);
  });

  it('strips restricted fields in mode "strip" and reports via onDrop', () => {
    const dropped: Array<[string, boolean]> = [];
    const out = sanitizeForTier1(
      'trip_places',
      { id: 'p1', rating: 4.8, reviews: [{ text: 'great' }], user_title: 'Louvre' },
      { mode: 'strip', onDrop: (f, r) => dropped.push([f, r]) },
    );
    expect(out).toEqual({ id: 'p1', user_title: 'Louvre' });
    expect(dropped).toEqual(
      expect.arrayContaining([
        ['rating', true],
        ['reviews', true],
      ]),
    );
    expect(JSON.stringify(out)).not.toMatch(/rating|review/);
  });

  it('the C3 scenario: an AI suggestion card with live Place data cannot persist', () => {
    const suggestionCard = {
      id: 's1',
      trip_id: 't1',
      google_place_id: 'ChIJ123',
      user_title: 'Suggested café',
      lat: 38.4,
      lng: 27.1,
      rating: 4.6, // ← live Tier-2 data accidentally left on the object
    };
    expect(() => sanitizeForTier1('trip_places', suggestionCard)).toThrow(
      SyncTosViolationError,
    );
  });
});

describe('sanitizeForTier1 — default-deny projection', () => {
  it('drops unknown (non-restricted) fields silently, keeps allowlisted ones', () => {
    const dropped: string[] = [];
    const out = sanitizeForTier1(
      'trip_expenses',
      { id: 'e1', trip_id: 't1', amount: 12, some_future_column: 'x' },
      { mode: 'throw', onDrop: (f) => dropped.push(f) },
    );
    expect(out).toEqual({ id: 'e1', trip_id: 't1', amount: 12 });
    expect(dropped).toEqual(['some_future_column']);
  });

  it('copies null and false through but skips undefined (merge safety)', () => {
    const out = sanitizeForTier1('trip_places', {
      id: 'p1',
      notes: null,
      deleted: false,
      user_title: undefined,
    });
    expect(out).toEqual({ id: 'p1', notes: null, deleted: false });
    expect('user_title' in out).toBe(false);
  });

  it('never mutates the input row', () => {
    const row = { id: 'p1', rating: 5 };
    const copy = { ...row };
    expect(() => sanitizeForTier1('trip_places', row)).toThrow();
    expect(row).toEqual(copy);
  });
});

describe('allowlist self-consistency (the two layers cannot drift)', () => {
  it('covers exactly the eight 0027 roots + the three M5 memory roots, and never trip_legs (R4)', () => {
    expect([...TIER1_TABLES].sort()).toEqual(
      [
        'trips',
        'trip_places',
        'trip_days',
        'trip_expenses',
        'trip_accommodations',
        'trip_place_reactions',
        'trip_place_comments',
        'trip_packing_items',
        'trip_journal_entries',
        'trip_place_reviews',
        'trip_photos',
      ].sort(),
    );
    expect(TIER1_TABLES).not.toContain('trip_legs');
  });

  it.each(TIER1_TABLES)('no allowlisted column on "%s" trips the restricted-name tripwire (bar the documented exception)', (table) => {
    const exceptions = new Set<string>((TIER1_USER_CONTENT_EXCEPTIONS[table] ?? []) as readonly string[]);
    for (const field of TIER1_FIELDS[table]) {
      expect({ table, field, restricted: isRestrictedFieldName(field) }).toEqual({
        table,
        field,
        restricted: exceptions.has(field),
      });
    }
  });

  it('the user-content exception is exactly trip_place_reviews.rating', () => {
    expect(TIER1_USER_CONTENT_EXCEPTIONS).toEqual({ trip_place_reviews: ['rating'] });
  });

  it('the sanctioned exception: *google_place_id passes despite the "photo" substring', () => {
    expect(isRestrictedFieldName('google_place_id')).toBe(false);
    expect(isRestrictedFieldName('cover_photo_google_place_id')).toBe(false);
    // …while a real photo field still trips:
    expect(isRestrictedFieldName('cover_photo_url')).toBe(true);
  });

  it.each(TIER1_TABLES)('tier1SelectColumns("%s") is derived from the same allowlist', (table) => {
    expect(tier1SelectColumns(table)).toBe(TIER1_FIELDS[table].join(','));
    const exceptions = new Set<string>((TIER1_USER_CONTENT_EXCEPTIONS[table] ?? []) as readonly string[]);
    const nonException = tier1SelectColumns(table)
      .split(',')
      .filter((c) => !exceptions.has(c))
      .join(',');
    expect(nonException).not.toMatch(/rating|review|photos|opening/);
  });

  it.each(TIER1_TABLES)('every "%s" allowlist entry includes the sync-critical columns', (table) => {
    const fields = TIER1_FIELDS[table];
    expect(fields).toContain('id');
    expect(fields).toContain('created_at');
    expect(fields).toContain('updated_at'); // LWW ordering depends on it
  });
});

// ===========================================================================
// S2.4 — the WRITE subset (C1: optimizer fields are server-only writers)
// ===========================================================================

describe('sanitizeForTier1Write — C1 server-only fields are stripped', () => {
  /** A realistic trip_places UPDATE payload: updatePartial:false means the
   * full hydrated row rides along, server-stamped fields included. */
  const hydratedPlaceRow = {
    id: 'p1',
    trip_id: 't1',
    google_place_id: 'ChIJ123',
    user_title: 'Louvre',
    category: 'museum',
    lat: 48.86,
    lng: 2.33,
    visit_duration_minutes: 90,
    day_index: 2, // ← optimizer-computed (C1)
    order_in_day: 3, // ← optimizer-computed (C1)
    notes: 'buy tickets online',
    details_refreshed_at: '2026-06-01T00:00:00Z',
    arrive_after: null,
    leave_before: '17:00:00',
    pinned_start: null,
    manual_rank: 'a0V',
    deleted: false,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-06-01T12:00:00Z',
  };

  it('strips day_index + order_in_day from trip_places writes (the C1 invariant)', () => {
    const dropped: Array<[string, Tier1WriteDropKind]> = [];
    const out = sanitizeForTier1Write('trip_places', hydratedPlaceRow, {
      onDrop: (f, k) => dropped.push([f, k]),
    }) as Record<string, unknown>;
    expect(out).not.toHaveProperty('day_index');
    expect(out).not.toHaveProperty('order_in_day');
    expect(out).not.toHaveProperty('details_refreshed_at');
    expect(dropped).toEqual(
      expect.arrayContaining([
        ['day_index', 'server_only'],
        ['order_in_day', 'server_only'],
        ['details_refreshed_at', 'server_only'],
      ]),
    );
  });

  it('never client-sends created_at / updated_at (handle_times owns the conflict clock)', () => {
    const out = sanitizeForTier1Write('trip_places', hydratedPlaceRow) as Record<string, unknown>;
    expect(out).not.toHaveProperty('created_at');
    expect(out).not.toHaveProperty('updated_at');

    const tripsOut = sanitizeForTier1Write('trips', {
      id: 't1',
      title: 'Rome',
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2099-01-01T00:00:00Z', // a forged clock must not pass
    }) as Record<string, unknown>;
    expect(tripsOut).not.toHaveProperty('created_at');
    expect(tripsOut).not.toHaveProperty('updated_at');
  });

  it('manual_rank passes (the ONLY client-writable order field)', () => {
    const out = sanitizeForTier1Write('trip_places', hydratedPlaceRow) as Record<string, unknown>;
    expect(out['manual_rank']).toBe('a0V');
  });

  it('deleted: true passes — tombstoning is the Wave-2 delete path', () => {
    const out = sanitizeForTier1Write('trip_places', {
      id: 'p1',
      created_at: '2026-05-01T00:00:00Z',
      deleted: true,
    }) as Record<string, unknown>;
    expect(out).toEqual({ id: 'p1', deleted: true });
  });

  it('trips: user_id is stripped (engine stamps it on create; RLS verifies)', () => {
    const dropped: Array<[string, Tier1WriteDropKind]> = [];
    const out = sanitizeForTier1Write(
      'trips',
      { id: 't1', user_id: 'u-evil', title: 'Rome' },
      { onDrop: (f, k) => dropped.push([f, k]) },
    ) as Record<string, unknown>;
    expect(out).toEqual({ id: 't1', title: 'Rome' });
    expect(dropped).toEqual([['user_id', 'server_only']]);
  });

  it('restricted Google fields THROW by default and strip with telemetry in strip mode (C3)', () => {
    expect(() =>
      sanitizeForTier1Write('trip_places', { id: 'p1', rating: 4.5 }),
    ).toThrow(SyncTosViolationError);

    const dropped: Array<[string, Tier1WriteDropKind]> = [];
    const out = sanitizeForTier1Write(
      'trip_places',
      { id: 'p1', rating: 4.5, day_index: 2, user_title: 'ok' },
      { mode: 'strip', onDrop: (f, k) => dropped.push([f, k]) },
    ) as Record<string, unknown>;
    expect(out).toEqual({ id: 'p1', user_title: 'ok' });
    expect(dropped).toEqual(
      expect.arrayContaining([
        ['rating', 'restricted'],
        ['day_index', 'server_only'],
      ]),
    );
  });

  it('unknown fields are default-denied with kind "unknown"', () => {
    const dropped: Array<[string, Tier1WriteDropKind]> = [];
    sanitizeForTier1Write(
      'trips',
      { id: 't1', title: 'Rome', some_future_column: 1 },
      { onDrop: (f, k) => dropped.push([f, k]) },
    );
    expect(dropped).toEqual([['some_future_column', 'unknown']]);
  });
});

describe('sanitizeForTier1Write — structural ids (engine requirements)', () => {
  it('CREATE (no created_at): id + trip_id pass through', () => {
    const out = sanitizeForTier1Write('trip_places', {
      id: 'p-new',
      trip_id: 't1',
      google_place_id: 'ChIJ123',
      lat: 1,
      lng: 2,
      manual_rank: 'a0',
    }) as Record<string, unknown>;
    expect(out['id']).toBe('p-new');
    expect(out['trip_id']).toBe('t1');
  });

  it('UPDATE (created_at present): id is retained (plugin .eq needs it), trip_id is dropped (parent not reassignable)', () => {
    const dropped: Array<[string, Tier1WriteDropKind]> = [];
    const out = sanitizeForTier1Write(
      'trip_places',
      { id: 'p1', trip_id: 't-other', notes: 'x', created_at: '2026-05-01T00:00:00Z' },
      { onDrop: (f, k) => dropped.push([f, k]) },
    ) as Record<string, unknown>;
    expect(out['id']).toBe('p1');
    expect(out).not.toHaveProperty('trip_id');
    expect(dropped).toEqual(
      expect.arrayContaining([
        ['trip_id', 'server_only'],
        ['created_at', 'server_only'],
      ]),
    );
  });

  it('never mutates the input patch', () => {
    const patch = { id: 'p1', day_index: 5, notes: 'n' };
    const copy = { ...patch };
    sanitizeForTier1Write('trip_places', patch);
    expect(patch).toEqual(copy);
  });
});

describe('write-allowlist self-consistency', () => {
  it('write-enables trips + trip_places (S2.4), expenses + packing (X2.5) and the M5 memory roots (Y2.1)', () => {
    expect([...TIER1_WRITE_TABLES].sort()).toEqual([
      'trip_expenses',
      'trip_journal_entries',
      'trip_packing_items',
      'trip_photos',
      'trip_place_reviews',
      'trip_places',
      'trips',
    ]);
    expect(isTier1WriteTable('trips')).toBe(true);
    expect(isTier1WriteTable('trip_places')).toBe(true);
    expect(isTier1WriteTable('trip_expenses')).toBe(true);
    expect(isTier1WriteTable('trip_packing_items')).toBe(true);
    expect(isTier1WriteTable('trip_days')).toBe(false);
    expect(isTier1WriteTable('trip_accommodations')).toBe(false);
  });

  it('throws on a table that is not write-enabled', () => {
    expect(() =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberately bypassing the type guard to test the runtime contract
      sanitizeForTier1Write('trip_days' as any, { id: 'd1', notes: 'x' }),
    ).toThrow(/not write-enabled/);
  });

  it.each(TIER1_WRITE_TABLES)('every "%s" write field is a subset of the read allowlist', (table) => {
    const readSet = new Set<string>(TIER1_FIELDS[table as Tier1Table]);
    for (const field of TIER1_WRITE_FIELDS[table]) {
      expect({ table, field, inReadAllowlist: readSet.has(field) }).toEqual({
        table,
        field,
        inReadAllowlist: true,
      });
    }
  });

  it.each(TIER1_WRITE_TABLES)('"%s" write fields never include the C1/C3 forbidden names', (table) => {
    const fields = TIER1_WRITE_FIELDS[table] as readonly string[];
    for (const forbidden of [
      'order_in_day',
      'details_refreshed_at',
      'created_at',
      'updated_at',
      'user_id',
      'id',
      'trip_id',
    ]) {
      expect(fields).not.toContain(forbidden);
    }
    // C1: day_index is OPTIMIZER order on trip_places (server-only). On
    // trip_expenses it is the user's "spent on day N" label — writable there.
    if (table === 'trip_places') expect(fields).not.toContain('day_index');
    const exceptions = new Set<string>((TIER1_USER_CONTENT_EXCEPTIONS[table] ?? []) as readonly string[]);
    for (const field of fields) {
      expect({ table, field, restricted: isRestrictedFieldName(field) }).toEqual({
        table,
        field,
        restricted: exceptions.has(field),
      });
    }
  });
});

describe('sanitizeForTier1Write: X2.5 expenses + packing', () => {
  const hydratedExpense = {
    id: 'e1',
    trip_id: 't1',
    category: 'food',
    amount: 12.5,
    kind: 'actual',
    day_index: 2,
    label: 'Lunch',
    deleted: false,
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
  };

  it('expense UPDATE keeps user fields (incl. the day_index label), strips timestamps + trip_id', () => {
    const dropped: Array<[string, Tier1WriteDropKind]> = [];
    const out = sanitizeForTier1Write('trip_expenses', hydratedExpense, {
      onDrop: (f, k) => dropped.push([f, k]),
    }) as Record<string, unknown>;
    expect(out).toEqual({
      id: 'e1',
      category: 'food',
      amount: 12.5,
      kind: 'actual',
      day_index: 2,
      label: 'Lunch',
      deleted: false,
    });
    expect(dropped).toEqual(
      expect.arrayContaining([
        ['trip_id', 'server_only'],
        ['created_at', 'server_only'],
        ['updated_at', 'server_only'],
      ]),
    );
  });

  it('expense CREATE (no created_at) carries trip_id', () => {
    const { created_at: _c, updated_at: _u, ...create } = hydratedExpense;
    const out = sanitizeForTier1Write('trip_expenses', create) as Record<string, unknown>;
    expect(out.trip_id).toBe('t1');
  });

  it('packing `auto` is create-only; updates drop it as server_only', () => {
    const create = { id: 'k1', trip_id: 't1', label: 'Socks', category: null, checked: false, auto: true, deleted: false };
    expect(sanitizeForTier1Write('trip_packing_items', create)).toEqual(create);

    const dropped: Array<[string, Tier1WriteDropKind]> = [];
    const out = sanitizeForTier1Write(
      'trip_packing_items',
      { ...create, checked: true, created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z' },
      { onDrop: (f, k) => dropped.push([f, k]) },
    ) as Record<string, unknown>;
    expect(out).toEqual({ id: 'k1', label: 'Socks', category: null, checked: true, deleted: false });
    expect(dropped).toEqual(expect.arrayContaining([['auto', 'server_only'], ['trip_id', 'server_only']]));
  });

  it('C3 still throws on restricted names for the new tables', () => {
    expect(() => sanitizeForTier1Write('trip_expenses', { id: 'e1', rating: 5 })).toThrow(SyncTosViolationError);
    expect(() => sanitizeForTier1Write('trip_packing_items', { id: 'k1', photos: [] })).toThrow(
      SyncTosViolationError,
    );
  });
});

// ===========================================================================
// M5 Y1.1 — multi-currency (0034) + per-leg modes (0035) on EXISTING roots
// ===========================================================================

describe('M5 Y1.1: money + leg-mode fields', () => {
  const MONEY = ['currency', 'fx_rate', 'fx_date', 'fx_home_currency'] as const;

  it('hydration allowlist gains the new columns (and the select projection asks for them)', () => {
    for (const f of MONEY) {
      expect(TIER1_FIELDS.trip_expenses).toContain(f);
      expect(tier1SelectColumns('trip_expenses').split(',')).toContain(f);
    }
    expect(TIER1_FIELDS.trip_places).toEqual(expect.arrayContaining(['arrival_mode', 'arrival_minutes']));
    expect(TIER1_FIELDS.trip_days).toContain('transport_mode');
  });

  it('write allowlist: expenses write the 4 money fields, places write the arrival override', () => {
    expect(TIER1_WRITE_FIELDS.trip_expenses).toEqual(expect.arrayContaining([...MONEY]));
    expect(TIER1_WRITE_FIELDS.trip_places).toEqual(expect.arrayContaining(['arrival_mode', 'arrival_minutes']));
    // trip_days stays a READ-ONLY root: the day default mode is written online.
    expect(isTier1WriteTable('trip_days')).toBe(false);
  });

  it('none of the new names trips the Google tripwire ("fx_rate" is not "rating")', () => {
    for (const f of [...MONEY, 'arrival_mode', 'arrival_minutes', 'transport_mode']) {
      expect({ f, restricted: isRestrictedFieldName(f) }).toEqual({ f, restricted: false });
    }
    // …while the real Google field still does.
    expect(isRestrictedFieldName('rating')).toBe(true);
    expect(() => sanitizeForTier1('trip_places', { id: 'p1', arrival_mode: 'flight', rating: 4.2 })).toThrow(
      SyncTosViolationError,
    );
  });

  it('hydrated expense rows keep the money fields (null = legacy / pending survives as null)', () => {
    const out = sanitizeForTier1('trip_expenses', {
      id: 'e1',
      trip_id: 't1',
      amount: 10,
      currency: 'EUR',
      fx_rate: null,
      fx_date: '2026-07-01',
      fx_home_currency: 'TRY',
    });
    expect(out).toEqual({
      id: 'e1',
      trip_id: 't1',
      amount: 10,
      currency: 'EUR',
      fx_rate: null,
      fx_date: '2026-07-01',
      fx_home_currency: 'TRY',
    });
  });

  it('expense UPDATE (full row, updatePartial:false) sends the money fields and still strips timestamps', () => {
    const out = sanitizeForTier1Write('trip_expenses', {
      id: 'e1',
      trip_id: 't1',
      category: 'food',
      amount: 10,
      kind: 'actual',
      day_index: null,
      label: 'Pasta',
      deleted: false,
      currency: 'EUR',
      fx_rate: 35.2,
      fx_date: '2026-07-01',
      fx_home_currency: 'TRY',
      created_at: '2026-07-01T10:00:00Z',
      updated_at: '2026-07-01T10:00:00Z',
    }) as Record<string, unknown>;
    expect(out).toEqual({
      id: 'e1',
      category: 'food',
      amount: 10,
      kind: 'actual',
      day_index: null,
      label: 'Pasta',
      deleted: false,
      currency: 'EUR',
      fx_rate: 35.2,
      fx_date: '2026-07-01',
      fx_home_currency: 'TRY',
    });
  });

  it('place UPDATE carries arrival_mode/arrival_minutes while C1 still strips day_index/order_in_day', () => {
    const dropped: Array<[string, Tier1WriteDropKind]> = [];
    const out = sanitizeForTier1Write(
      'trip_places',
      {
        id: 'p1',
        trip_id: 't1',
        day_index: 1,
        order_in_day: 0,
        manual_rank: 'a1',
        arrival_mode: 'flight',
        arrival_minutes: 120,
        created_at: '2026-07-01T10:00:00Z',
      },
      { onDrop: (f, k) => dropped.push([f, k]) },
    ) as Record<string, unknown>;
    expect(out).toEqual({ id: 'p1', manual_rank: 'a1', arrival_mode: 'flight', arrival_minutes: 120 });
    expect(dropped).toEqual(
      expect.arrayContaining([
        ['day_index', 'server_only'],
        ['order_in_day', 'server_only'],
      ]),
    );
  });

  it('trip_legs (and its new `source` provenance) never becomes a Tier-1 root (R4)', () => {
    expect(TIER1_TABLES).not.toContain('trip_legs');
    expect(Object.prototype.hasOwnProperty.call(TIER1_WRITE_FIELDS, 'trip_legs')).toBe(false);
  });
});

// ===========================================================================
// M5 Y2.1 — memory roots (0036/0038): author-scoped, server-owned columns
// read-only, the review `rating` exception scoped to its table
// ===========================================================================

describe('M5 Y2.1: memory roots', () => {
  const T = '2026-07-14T10:00:00Z';

  it('are author-scoped (own rows only) and trip_photos is update-only', () => {
    expect([...TIER1_AUTHOR_SCOPED_TABLES].sort()).toEqual(['trip_journal_entries', 'trip_photos', 'trip_place_reviews']);
    expect(isTier1AuthorScopedTable('trip_places')).toBe(false);
    expect(isTier1AuthorScopedTable('trip_place_comments')).toBe(false);
    expect([...TIER1_UPDATE_ONLY_TABLES]).toEqual(['trip_photos']);
    for (const t of ['trip_journal_entries', 'trip_place_reviews', 'trip_photos'] as const) {
      expect(TIER1_FIELDS[t]).toContain('author_id');
      expect(TIER1_FIELDS[t]).toContain('visibility');
      expect(TIER1_FIELDS[t]).toContain('deleted');
    }
  });

  it('review `rating` (USER stars) is allowed on trip_place_reviews ONLY — trip_places.rating still throws', () => {
    expect(sanitizeForTier1('trip_place_reviews', { id: 'r1', rating: 4, body: 'Great view' })).toEqual({
      id: 'r1',
      rating: 4,
      body: 'Great view',
    });
    expect(sanitizeForTier1Write('trip_place_reviews', { id: 'r1', rating: 5 })).toEqual({ id: 'r1', rating: 5 });
    expect(() => sanitizeForTier1('trip_places', { id: 'p1', rating: 4.5 })).toThrow(SyncTosViolationError);
    expect(() => sanitizeForTier1Write('trip_places', { id: 'p1', rating: 4.5 })).toThrow(SyncTosViolationError);
    expect(() => sanitizeForTier1('trip_journal_entries', { id: 'j1', rating: 3 })).toThrow(SyncTosViolationError);
    expect(() => sanitizeForTier1('trip_photos', { id: 'x1', rating: 3 })).toThrow(SyncTosViolationError);
    // Google review content is still refused on the review table itself.
    expect(() => sanitizeForTier1('trip_place_reviews', { id: 'r1', reviews: [] })).toThrow(SyncTosViolationError);
    expect(() => sanitizeForTier1('trip_place_reviews', { id: 'r1', user_rating_count: 12 })).toThrow(
      SyncTosViolationError,
    );
  });

  it('journal: create carries trip_id + author_id; updates strip them and the timestamps', () => {
    const create = { id: 'j1', trip_id: 't1', author_id: 'u1', day_index: 2, body: 'Ferry to Kadıköy', visibility: 'only_me', deleted: false };
    expect(sanitizeForTier1Write('trip_journal_entries', create)).toEqual(create);
    const dropped: Array<[string, Tier1WriteDropKind]> = [];
    const out = sanitizeForTier1Write(
      'trip_journal_entries',
      { ...create, visibility: 'trip', created_at: T, updated_at: T },
      { onDrop: (f, k) => dropped.push([f, k]) },
    );
    expect(out).toEqual({ id: 'j1', day_index: 2, body: 'Ferry to Kadıköy', visibility: 'trip', deleted: false });
    expect(dropped).toEqual(
      expect.arrayContaining([
        ['trip_id', 'server_only'],
        ['author_id', 'server_only'],
        ['created_at', 'server_only'],
        ['updated_at', 'server_only'],
      ]),
    );
  });

  it('review: trip_place_id is create-only; snapshots are server-owned (hydrated, never written)', () => {
    const hydrated = {
      id: 'r1',
      trip_id: 't1',
      trip_place_id: 'p1',
      author_id: 'u1',
      rating: 4,
      body: 'Busy',
      visibility: 'only_me',
      place_name_snapshot: 'Galata Tower',
      place_google_id_snapshot: 'ChIJ-galata',
      deleted: false,
      created_at: T,
      updated_at: T,
    };
    // Hydration keeps the snapshots (read-only display data).
    expect(sanitizeForTier1('trip_place_reviews', hydrated)).toEqual(hydrated);
    const dropped: Array<[string, Tier1WriteDropKind]> = [];
    expect(sanitizeForTier1Write('trip_place_reviews', hydrated, { onDrop: (f, k) => dropped.push([f, k]) })).toEqual({
      id: 'r1',
      rating: 4,
      body: 'Busy',
      visibility: 'only_me',
      deleted: false,
    });
    expect(dropped).toEqual(
      expect.arrayContaining([
        ['trip_place_id', 'server_only'],
        ['place_name_snapshot', 'server_only'],
        ['place_google_id_snapshot', 'server_only'],
      ]),
    );
    const { created_at: _c, updated_at: _u, place_name_snapshot: _n, place_google_id_snapshot: _g, ...create } = hydrated;
    expect(sanitizeForTier1Write('trip_place_reviews', create)).toEqual(create);
  });

  it('photo: server-owned columns (status/bytes/paths/timestamps) and trip_place_id never go on the wire', () => {
    const hydrated = {
      id: 'x1',
      trip_id: 't1',
      author_id: 'u1',
      day_index: 1,
      trip_place_id: 'p1',
      storage_path: 't1/u1/x1.jpg',
      thumb_path: 't1/u1/x1_t.jpg',
      width: 1600,
      height: 1200,
      bytes: 301234,
      thumb_bytes: 30123,
      caption: 'Sunset',
      taken_at: T,
      status: 'ready',
      visibility: 'trip',
      deleted: false,
      created_at: T,
      updated_at: T,
    };
    expect(sanitizeForTier1('trip_photos', hydrated)).toEqual(hydrated);
    const out = sanitizeForTier1Write('trip_photos', hydrated) as Record<string, unknown>;
    expect(out).toEqual({ id: 'x1', day_index: 1, caption: 'Sunset', taken_at: T, visibility: 'trip', deleted: false });
    for (const k of ['status', 'bytes', 'thumb_bytes', 'storage_path', 'thumb_path', 'trip_place_id', 'width', 'height', 'author_id', 'trip_id']) {
      expect(out).not.toHaveProperty(k);
    }
  });
});
