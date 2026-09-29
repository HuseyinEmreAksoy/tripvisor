/**
 * app/(app)/_layout.tsx — buildPendingPath (F3): a signed-out deep link keeps
 * its destination (path + query) across the sign-in round trip. Lives outside
 * app/ so Expo Router never treats it as a route.
 */
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@/api', () => ({ useSession: () => ({ data: null, isLoading: false }) }));
jest.mock('@/components/UndoToast', () => ({ UndoToast: () => null }));
jest.mock('@/lib/pendingRedirect', () => ({ setPendingRedirect: jest.fn(async () => undefined) }));

// eslint-disable-next-line import/first
import { buildPendingPath } from '../../../../app/(app)/_layout';

describe('buildPendingPath', () => {
  it('keeps the query but drops dynamic segment params', () => {
    expect(
      buildPendingPath('/trip/abc', { id: 'abc', tab: 'map' }, ['(app)', 'trip', '[id]']),
    ).toBe('/trip/abc?tab=map');
  });

  it('keeps nested deep paths without a query', () => {
    expect(
      buildPendingPath('/trip/abc/packing', { id: 'abc' }, ['(app)', 'trip', '[id]', 'packing']),
    ).toBe('/trip/abc/packing');
    expect(buildPendingPath('/today', {}, ['(app)', '(tabs)', 'today'])).toBe('/today');
  });

  it('does not store tab roots (where sign-out happens)', () => {
    expect(buildPendingPath('/trips', {}, ['(app)', '(tabs)', 'trips'])).toBeNull();
    expect(buildPendingPath('/settings', {}, ['(app)', '(tabs)', 'settings'])).toBeNull();
  });
});
