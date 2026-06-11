/**
 * C3 guard suite — the Tier-1 ToS firewall (v2 S2.3).
 *
 * The Legend-State SQLite store is a second persistence engine the TanStack
 * `shouldDehydrateQuery` allowlist does not govern; these tests are the
 * regression net keeping Google-restricted Place content out of it
 * (docs/v2/risks-and-decisions.md C3).
 */
import {
  TIER1_FIELDS,
  TIER1_TABLES,
  SyncTosViolationError,
  isRestrictedFieldName,
  sanitizeForTier1,
  tier1SelectColumns,
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
  it('covers exactly the eight Tier-1 roots, and never trip_legs (R4)', () => {
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
      ].sort(),
    );
    expect(TIER1_TABLES).not.toContain('trip_legs');
  });

  it.each(TIER1_TABLES)('no allowlisted column on "%s" trips the restricted-name tripwire', (table) => {
    for (const field of TIER1_FIELDS[table]) {
      expect({ table, field, restricted: isRestrictedFieldName(field) }).toEqual({
        table,
        field,
        restricted: false,
      });
    }
  });

  it('the sanctioned exception: *google_place_id passes despite the "photo" substring', () => {
    expect(isRestrictedFieldName('google_place_id')).toBe(false);
    expect(isRestrictedFieldName('cover_photo_google_place_id')).toBe(false);
    // …while a real photo field still trips:
    expect(isRestrictedFieldName('cover_photo_url')).toBe(true);
  });

  it.each(TIER1_TABLES)('tier1SelectColumns("%s") is derived from the same allowlist', (table) => {
    expect(tier1SelectColumns(table)).toBe(TIER1_FIELDS[table].join(','));
    expect(tier1SelectColumns(table)).not.toMatch(/rating|review|photos|opening/);
  });

  it.each(TIER1_TABLES)('every "%s" allowlist entry includes the sync-critical columns', (table) => {
    const fields = TIER1_FIELDS[table];
    expect(fields).toContain('id');
    expect(fields).toContain('created_at');
    expect(fields).toContain('updated_at'); // LWW ordering depends on it
  });
});
