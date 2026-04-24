/**
 * offline.web — shouldDehydrateQuery allowlist tests.
 *
 * Imports from the .web path because Jest runs in Node, which behaves
 * like the web bundle (no native NetInfo). The web implementation uses
 * navigator.onLine and has no native deps.
 */

// We import directly from offline.web to bypass Metro's platform resolution.
// Jest resolves from offline.web.ts explicitly.
import { shouldDehydrateQuery } from '../offline.web';
import type { Query } from '@tanstack/react-query';

/** Minimal Query stub — only queryKey is needed by shouldDehydrateQuery. */
function fakeQuery(queryKey: unknown[]): Query {
  return { queryKey } as unknown as Query;
}

describe('shouldDehydrateQuery — allowlist', () => {
  // Keys that SHOULD be persisted
  const persistedCases: Array<{ label: string; key: unknown[] }> = [
    { label: '["trips"]', key: ['trips'] },
    { label: '["trips", "abc"]', key: ['trips', 'abc'] },
    { label: '["trip-places", "abc"]', key: ['trip-places', 'abc'] },
    { label: '["trip-legs", "abc"]', key: ['trip-legs', 'abc'] },
  ];

  it.each(persistedCases)('returns true for $label', ({ key }) => {
    expect(shouldDehydrateQuery(fakeQuery(key))).toBe(true);
  });

  // Keys that should NOT be persisted (Google ToS + catch-all)
  const nonPersistedCases: Array<{ label: string; key: unknown[] }> = [
    { label: '["place-details", "xyz"]', key: ['place-details', 'xyz'] },
    { label: '["places-autocomplete", "query"]', key: ['places-autocomplete', 'query'] },
    { label: '["anything-else"]', key: ['anything-else'] },
    { label: '["share"]', key: ['share'] },
    { label: '["share", "trip", "token"]', key: ['share', 'trip', 'token'] },
  ];

  it.each(nonPersistedCases)('returns false for $label', ({ key }) => {
    expect(shouldDehydrateQuery(fakeQuery(key))).toBe(false);
  });

  it('returns false when queryKey root is not a string', () => {
    expect(shouldDehydrateQuery(fakeQuery([42]))).toBe(false);
    expect(shouldDehydrateQuery(fakeQuery([{ type: 'trips' }]))).toBe(false);
  });

  it('returns false for an empty queryKey', () => {
    expect(shouldDehydrateQuery(fakeQuery([]))).toBe(false);
  });
});
