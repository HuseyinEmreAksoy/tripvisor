/**
 * M5 Y2.2 — persister allowlist: FX rates are persisted (ADR-0012 §4, the
 * offline "last-known rate map"), successful queries only; recommendations,
 * preferences and the reconciler's role lookup are NOT. Both platform files.
 */
import { describe, expect, it, jest } from '@jest/globals';
import type { Query } from '@tanstack/react-query';

jest.mock('@react-native-community/netinfo', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);

/* eslint-disable import/first */
import { shouldDehydrateQuery as webShould } from '../offline.web';
import { shouldDehydrateQuery as nativeShould } from '../offline.native';
/* eslint-enable import/first */

function query(queryKey: unknown[], status: 'success' | 'error' | 'pending' = 'success'): Query {
  return { queryKey, state: { status } } as unknown as Query;
}

describe.each([
  ['web', webShould],
  ['native', nativeShould],
])('%s allowlist', (_platform, shouldDehydrateQuery) => {
  it('persists successful fx queries (pairs, rate tables, fx_rates books, currencies)', () => {
    expect(shouldDehydrateQuery(query(['fx', 'pair', 'EUR', 'TRY', 'latest']))).toBe(true);
    expect(shouldDehydrateQuery(query(['fx', 'rates', 'EUR', '2026-09-20', 'TRY,USD']))).toBe(true);
    expect(shouldDehydrateQuery(query(['fx', 'book', '2026-09-20', 'TRY,USD']))).toBe(true);
    expect(shouldDehydrateQuery(query(['fx', 'currencies']))).toBe(true);
  });

  it('never persists a failed or pending fx query', () => {
    expect(shouldDehydrateQuery(query(['fx', 'pair', 'EUR', 'TRY', 'latest'], 'error'))).toBe(false);
    expect(shouldDehydrateQuery(query(['fx', 'book', '2026-09-20', 'TRY'], 'pending'))).toBe(false);
  });

  it('keeps recommendations, preferences and reconciler lookups memory-only', () => {
    expect(shouldDehydrateQuery(query(['recommendations', 'x']))).toBe(false);
    expect(shouldDehydrateQuery(query(['user-preferences', 'u1']))).toBe(false);
    expect(shouldDehydrateQuery(query(['fx-reconciler', 'roles', 'u1']))).toBe(false);
    expect(shouldDehydrateQuery(query(['place-details', 'x']))).toBe(false);
  });
});
