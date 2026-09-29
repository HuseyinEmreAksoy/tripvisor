/**
 * M5 Y1.1 — the mutation layer's money (0034) and per-leg mode (0035) fields.
 *
 * Same harness as mutations.expenses-packing.test.ts: the REAL tier1Store$ with
 * no engine attached (hydrate.ts mocked down to the activity gate). Asserts:
 *   - creates stay COMPLETE (the new fields are explicit, nulls included);
 *   - every 0034/0035 CHECK is mirrored client-side and throws
 *     SyncWriteError('invalid_value') BEFORE the store is touched (a server-
 *     rejected Tier-1 write would otherwise be retried forever);
 *   - update inverses restore the prior money/mode values.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

let mockActive = true;
jest.mock('../hydrate', () => ({ isTier1SyncInitialized: () => mockActive }));
jest.mock('../flags', () => ({ isTier1SyncEnabled: () => true }));

import {
  SyncWriteError,
  createExpense,
  createPlace,
  createTrip,
  updateExpense,
  updatePlace,
  updateTrip,
} from '../mutations';
import { tier1Store$ } from '../store';
import type { TripCurrency } from '../../api/types';

beforeEach(() => {
  mockActive = true;
  tier1Store$.trips.set({});
  tier1Store$.tripPlaces.set({});
  tier1Store$.tripExpenses.set({});
});

function expectInvalid(call: () => unknown, message?: RegExp): void {
  try {
    call();
  } catch (err) {
    expect(err).toBeInstanceOf(SyncWriteError);
    expect((err as SyncWriteError).code).toBe('invalid_value');
    if (message) expect((err as Error).message).toMatch(message);
    return;
  }
  throw new Error('expected an invalid_value SyncWriteError');
}

const storeSize = (rec: Record<string, unknown> | undefined) => Object.keys(rec ?? {}).length;

describe('expenses: money fields (0034)', () => {
  it('a frozen-rate create is COMPLETE and keeps the original amount + currency', () => {
    const id = createExpense({
      trip_id: 't1',
      category: 'food',
      amount: 12.5,
      kind: 'actual',
      currency: 'EUR',
      fx_rate: 35.2,
      fx_date: '2026-07-01',
      fx_home_currency: 'TRY',
    });
    expect(tier1Store$.tripExpenses[id]!.peek()).toEqual({
      id,
      trip_id: 't1',
      category: 'food',
      amount: 12.5,
      kind: 'actual',
      day_index: null,
      label: null,
      deleted: false,
      currency: 'EUR',
      fx_rate: 35.2,
      fx_date: '2026-07-01',
      fx_home_currency: 'TRY',
    });
  });

  it('an offline "rate pending" create (fx_rate null, date + home known) is allowed', () => {
    const id = createExpense({
      trip_id: 't1',
      category: 'food',
      amount: 5,
      currency: 'EUR',
      fx_rate: null,
      fx_date: '2026-07-01',
      fx_home_currency: 'TRY',
    });
    expect(tier1Store$.tripExpenses[id]!.peek()).toMatchObject({ currency: 'EUR', fx_rate: null });
  });

  it.each([
    ['lower-case currency', { currency: 'eur' }, /currency/],
    ['4-letter currency', { currency: 'EURO' }, /currency/],
    ['lower-case home currency', { currency: 'EUR', fx_home_currency: 'try' }, /fx_home_currency/],
    ['zero rate', { currency: 'EUR', fx_rate: 0, fx_date: '2026-07-01', fx_home_currency: 'TRY' }, /fx_rate/],
    ['negative rate', { currency: 'EUR', fx_rate: -1, fx_date: '2026-07-01', fx_home_currency: 'TRY' }, /fx_rate/],
    ['NaN rate', { currency: 'EUR', fx_rate: Number.NaN, fx_date: '2026-07-01', fx_home_currency: 'TRY' }, /fx_rate/],
    ['impossible date', { currency: 'EUR', fx_rate: null, fx_date: '2026-02-30', fx_home_currency: 'TRY' }, /fx_date/],
    ['non-ISO date', { currency: 'EUR', fx_rate: null, fx_date: '01/07/2026', fx_home_currency: 'TRY' }, /fx_date/],
    ['frozen rate without fx_date', { currency: 'EUR', fx_rate: 35, fx_home_currency: 'TRY' }, /frozen fx_rate/],
    ['frozen rate without home', { currency: 'EUR', fx_rate: 35, fx_date: '2026-07-01' }, /frozen fx_rate/],
    ['frozen rate without currency', { fx_rate: 35, fx_date: '2026-07-01', fx_home_currency: 'TRY' }, /frozen fx_rate/],
    ['negative amount', { amount: -1 }, /amount/],
  ])('rejects %s before touching the store', (_name, extra, message) => {
    expectInvalid(
      () => createExpense({ trip_id: 't1', category: 'food', amount: 10, ...(extra as object) }),
      message,
    );
    expect(storeSize(tier1Store$.tripExpenses.peek())).toBe(0);
  });

  it('the reconciler fill (pending → frozen) is an ordinary update; its inverse restores "pending"', () => {
    const id = createExpense({
      trip_id: 't1',
      category: 'food',
      amount: 5,
      currency: 'EUR',
      fx_date: '2026-07-01',
      fx_home_currency: 'TRY',
    });
    const undo = updateExpense(id, { fx_rate: 35.5, fx_date: '2026-07-01', fx_home_currency: 'TRY' });
    expect(tier1Store$.tripExpenses[id]!.peek()).toMatchObject({ fx_rate: 35.5 });
    void undo.inverse();
    expect(tier1Store$.tripExpenses[id]!.peek()).toMatchObject({ fx_rate: null, currency: 'EUR' });
  });

  it('the frozen-rate rule is checked on the MERGED row (prev + patch)', () => {
    // Legacy-shaped row (currency null): setting only fx_rate would violate the CHECK server-side.
    const id = createExpense({ trip_id: 't1', category: 'food', amount: 5 });
    expectInvalid(() => updateExpense(id, { fx_rate: 2 }), /frozen fx_rate/);
    expect(tier1Store$.tripExpenses[id]!.peek()).toMatchObject({ fx_rate: null });
    // Supplying the missing columns in the same patch makes it valid.
    updateExpense(id, { currency: 'USD', fx_rate: 32.3, fx_date: '2026-07-01', fx_home_currency: 'TRY' });
    expect(tier1Store$.tripExpenses[id]!.peek()).toMatchObject({ currency: 'USD', fx_rate: 32.3 });
  });

  it('clearing a frozen rate back to "pending" is allowed', () => {
    const id = createExpense({
      trip_id: 't1',
      category: 'food',
      amount: 5,
      currency: 'EUR',
      fx_rate: 35,
      fx_date: '2026-07-01',
      fx_home_currency: 'TRY',
    });
    updateExpense(id, { fx_rate: null });
    expect(tier1Store$.tripExpenses[id]!.peek()).toMatchObject({ fx_rate: null, fx_date: '2026-07-01' });
  });

  it('a label-only edit is never blocked by an untouched hydrated value', () => {
    // A hydrated row as the server sent it (valid by construction); the guard
    // only re-checks the fields a patch writes (+ the coupling rule when a
    // money field is touched).
    tier1Store$.tripExpenses.set({
      e1: {
        id: 'e1',
        trip_id: 't1',
        category: 'food',
        amount: 5,
        kind: 'actual',
        day_index: null,
        label: 'Coffee',
        deleted: false,
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-01T10:00:00Z',
      },
    });
    updateExpense('e1', { label: 'Espresso' });
    expect(tier1Store$.tripExpenses.e1!.peek()?.label).toBe('Espresso');
  });
});

describe('places: per-leg arrival override (0035)', () => {
  const base = { trip_id: 't1', google_place_id: 'ChIJx', lat: 41, lng: 29 };

  it('createPlace writes the arrival fields explicitly (null = inherit)', () => {
    const id = createPlace(base);
    expect(tier1Store$.tripPlaces[id]!.peek()).toMatchObject({ arrival_mode: null, arrival_minutes: null });
    const flight = createPlace({ ...base, arrival_mode: 'flight', arrival_minutes: 120 });
    expect(tier1Store$.tripPlaces[flight]!.peek()).toMatchObject({ arrival_mode: 'flight', arrival_minutes: 120 });
  });

  it.each([
    ['unknown mode', { arrival_mode: 'boat' }, /arrival_mode/],
    ['zero minutes', { arrival_mode: 'ferry', arrival_minutes: 0 }, /arrival_minutes/],
    ['over 24 h', { arrival_mode: 'flight', arrival_minutes: 1441 }, /arrival_minutes/],
    ['fractional minutes', { arrival_mode: 'transit', arrival_minutes: 12.5 }, /arrival_minutes/],
  ])('createPlace rejects %s before touching the store', (_name, extra, message) => {
    expectInvalid(() => createPlace({ ...base, ...(extra as object) }), message);
    expect(storeSize(tier1Store$.tripPlaces.peek())).toBe(0);
  });

  it('updatePlace sets and clears the override; inverse restores; bad values throw', () => {
    const id = createPlace(base);
    const undo = updatePlace(id, { arrival_mode: 'transit', arrival_minutes: 45 });
    expect(tier1Store$.tripPlaces[id]!.peek()).toMatchObject({ arrival_mode: 'transit', arrival_minutes: 45 });
    void undo.inverse();
    expect(tier1Store$.tripPlaces[id]!.peek()).toMatchObject({ arrival_mode: null, arrival_minutes: null });

    expectInvalid(() => updatePlace(id, { arrival_mode: 'teleport' as never }), /arrival_mode/);
    expect(tier1Store$.tripPlaces[id]!.peek()?.arrival_mode).toBeNull();
  });

  it('updatePlace never lets optimizer order ride along (C1 unchanged)', () => {
    const id = createPlace(base);
    updatePlace(id, { arrival_mode: 'walking', ...({ day_index: 3, order_in_day: 1 } as object) });
    const row = tier1Store$.tripPlaces[id]!.peek()!;
    expect(row.arrival_mode).toBe('walking');
    expect(row.day_index).toBeNull();
    expect(row.order_in_day).toBeNull();
  });
});

describe('trips: widened home currency (0034 §1)', () => {
  // TripCurrency stays the 5-code picker union until Y3.2 widens the pickers
  // (see its JSDoc); the DB and this guard already accept any ISO code, so the
  // casts below model a value another client/the dashboard may have written.
  const iso = (code: string) => code as TripCurrency;

  it('accepts any ISO code, rejects malformed ones before the store write', () => {
    const id = createTrip({ title: 'Zürich', currency: iso('CHF') });
    expect(tier1Store$.trips[id]!.peek()?.currency).toBe('CHF');
    expectInvalid(() => createTrip({ title: 'bad', currency: iso('chf') }), /currency/);
    expect(storeSize(tier1Store$.trips.peek())).toBe(1);

    expectInvalid(() => updateTrip(id, { currency: iso('Swiss') }), /currency/);
    expect(tier1Store$.trips[id]!.peek()?.currency).toBe('CHF');
    updateTrip(id, { currency: 'TRY' });
    expect(tier1Store$.trips[id]!.peek()?.currency).toBe('TRY');
  });
});
