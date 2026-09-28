/**
 * M4 X2.5 — mutation layer for trip_expenses + trip_packing_items.
 *
 * The store is the REAL tier1Store$ (a plain observable here: no sync engine
 * attached — hydrate.ts is mocked down to the activity gate). Asserts the
 * engine-facing contracts from mutations.ts' header:
 *   - client-minted UUIDs, COMPLETE creates, created_at/updated_at NEVER set;
 *   - update/tombstone return UndoEntry inverses that restore prior state;
 *   - tombstone = `deleted: true` (never a store-level delete);
 *   - the packing bulk seed lands as ONE store change;
 *   - everything throws `sync_inactive` when the engine is not active.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

let mockActive = true;
jest.mock('../hydrate', () => ({ isTier1SyncInitialized: () => mockActive }));
jest.mock('../flags', () => ({ isTier1SyncEnabled: () => true }));

import {
  SyncWriteError,
  createExpense,
  createPackingItems,
  tombstoneExpense,
  tombstonePackingItem,
  updateExpense,
  updatePackingItem,
} from '../mutations';
import { tier1Store$ } from '../store';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  mockActive = true;
  tier1Store$.tripExpenses.set({});
  tier1Store$.tripPackingItems.set({});
});

describe('expenses', () => {
  it('createExpense writes a COMPLETE row with a client UUID and no server timestamps', () => {
    const id = createExpense({ trip_id: 't1', category: 'food', amount: 9.5 });
    expect(id).toMatch(UUID_RE);
    const row = tier1Store$.tripExpenses[id]!.peek() as unknown as Record<string, unknown>;
    expect(row).toEqual({
      id,
      trip_id: 't1',
      category: 'food',
      amount: 9.5,
      kind: 'estimated',
      day_index: null,
      label: null,
      deleted: false,
    });
    expect('created_at' in row).toBe(false);
    expect('updated_at' in row).toBe(false);
  });

  it('updateExpense only writes allowlisted fields; its inverse restores the prior values', () => {
    const id = createExpense({ trip_id: 't1', category: 'food', amount: 10, label: 'Lunch' });
    const undo = updateExpense(id, {
      amount: 25,
      label: null,
      // junk the facade could never send, but the helper must still refuse it
      ...({ deleted: true, created_at: 'x', trip_id: 't2' } as object),
    });
    const after = tier1Store$.tripExpenses[id]!.peek()!;
    expect(after.amount).toBe(25);
    expect(after.label).toBeNull();
    expect(after.deleted).toBe(false);
    expect(after.trip_id).toBe('t1');
    expect((after as unknown as Record<string, unknown>).created_at).toBeUndefined();

    void undo.inverse();
    const reverted = tier1Store$.tripExpenses[id]!.peek()!;
    expect(reverted.amount).toBe(10);
    expect(reverted.label).toBe('Lunch');
  });

  it('tombstoneExpense sets deleted=true (row kept); inverse un-tombstones', () => {
    const id = createExpense({ trip_id: 't1', category: 'transport', amount: 3, kind: 'actual' });
    const undo = tombstoneExpense(id);
    expect(tier1Store$.tripExpenses[id]!.peek()?.deleted).toBe(true);
    void undo.inverse();
    expect(tier1Store$.tripExpenses[id]!.peek()?.deleted).toBe(false);
  });

  it('tombstone inverse re-seeds the captured snapshot (incl. created_at) if the row was pruned', () => {
    tier1Store$.tripExpenses.set({
      e1: {
        id: 'e1',
        trip_id: 't1',
        category: 'food',
        amount: 5,
        kind: 'actual',
        day_index: 1,
        label: 'Coffee',
        deleted: false,
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-01T10:00:00Z',
      },
    });
    const undo = tombstoneExpense('e1');
    tier1Store$.tripExpenses.e1!.delete();
    void undo.inverse();
    const row = tier1Store$.tripExpenses.e1!.peek();
    expect(row?.deleted).toBe(false);
    // created_at present ⇒ the engine classifies it as an UPDATE, never a duplicate INSERT
    expect(row?.created_at).toBe('2026-09-01T10:00:00Z');
  });

  it('missing rows throw row_not_found', () => {
    expect(() => updateExpense('nope', { amount: 1 })).toThrow(SyncWriteError);
    expect(() => tombstoneExpense('nope')).toThrow(/not in the local store/);
  });
});

describe('packing', () => {
  it('createPackingItems seeds a batch in ONE store change with complete rows', () => {
    const changes: number[] = [];
    const unsub = tier1Store$.tripPackingItems.onChange(() => changes.push(1));
    const ids = createPackingItems('t1', [
      { label: 'Socks', category: 'clothing', auto: true },
      { label: 'Charger' },
    ]);
    unsub();
    expect(changes).toHaveLength(1);
    expect(ids).toHaveLength(2);
    ids.forEach((id) => expect(id).toMatch(UUID_RE));
    expect(tier1Store$.tripPackingItems[ids[0]!]!.peek()).toEqual({
      id: ids[0],
      trip_id: 't1',
      label: 'Socks',
      category: 'clothing',
      checked: false,
      auto: true,
      deleted: false,
    });
    expect(tier1Store$.tripPackingItems[ids[1]!]!.peek()).toMatchObject({
      category: null,
      auto: false,
      checked: false,
      deleted: false,
    });
  });

  it('an empty batch is a no-op', () => {
    expect(createPackingItems('t1', [])).toEqual([]);
    expect(tier1Store$.tripPackingItems.peek()).toEqual({});
  });

  it('updatePackingItem ticks; `auto`/`deleted` are not patchable; inverse unticks', () => {
    const [id] = createPackingItems('t1', [{ label: 'Passport', auto: true }]);
    const undo = updatePackingItem(id!, {
      checked: true,
      ...({ auto: false, deleted: true } as object),
    });
    const row = tier1Store$.tripPackingItems[id!]!.peek()!;
    expect(row.checked).toBe(true);
    expect(row.auto).toBe(true);
    expect(row.deleted).toBe(false);
    void undo.inverse();
    expect(tier1Store$.tripPackingItems[id!]!.peek()!.checked).toBe(false);
  });

  it('tombstonePackingItem + inverse', () => {
    const [id] = createPackingItems('t1', [{ label: 'Hat' }]);
    const undo = tombstonePackingItem(id!);
    expect(tier1Store$.tripPackingItems[id!]!.peek()?.deleted).toBe(true);
    void undo.inverse();
    expect(tier1Store$.tripPackingItems[id!]!.peek()?.deleted).toBe(false);
  });
});

describe('gate', () => {
  it('every helper throws sync_inactive when the engine is not active', () => {
    mockActive = false;
    const calls: Array<() => unknown> = [
      () => createExpense({ trip_id: 't1', category: 'food', amount: 1 }),
      () => updateExpense('e', { amount: 1 }),
      () => tombstoneExpense('e'),
      () => createPackingItems('t1', [{ label: 'x' }]),
      () => updatePackingItem('k', { checked: true }),
      () => tombstonePackingItem('k'),
    ];
    for (const call of calls) {
      try {
        call();
        throw new Error('expected a throw');
      } catch (err) {
        expect(err).toBeInstanceOf(SyncWriteError);
        expect((err as SyncWriteError).code).toBe('sync_inactive');
      }
    }
  });
});
