/**
 * offline — dehydration allowlist integration test.
 *
 * Seeds a QueryClient with 4 distinct query keys, runs dehydrate() with the
 * shouldDehydrateQuery allowlist, then asserts:
 *   - exactly 2 queries are dehydrated (trips + trip-places)
 *   - none of the dehydrated queries have a key root of "place-details" or
 *     "places-autocomplete"
 */
import { QueryClient, dehydrate } from '@tanstack/react-query';
import { shouldDehydrateQuery } from '../offline.web';

async function seedQueryClient(): Promise<QueryClient> {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

  // Seed 4 queries with distinct data so the cache is non-empty
  client.setQueryData(['trips'], [{ id: '1', title: 'Trip A' }]);
  client.setQueryData(['trip-places', 'trip-1'], [{ id: 'p1' }]);
  client.setQueryData(['place-details', 'ChIJ_xyz'], { displayName: 'Belem Tower' });
  client.setQueryData(['places-autocomplete', 'lisbon'], [{ placeId: 'abc' }]);

  return client;
}

describe('dehydrate with shouldDehydrateQuery allowlist', () => {
  it('dehydrates exactly 2 queries (trips + trip-places)', async () => {
    const client = await seedQueryClient();
    const dehydrated = dehydrate(client, { shouldDehydrateQuery });
    expect(dehydrated.queries).toHaveLength(2);
    client.clear();
  });

  it('dehydrated set contains ["trips"] key', async () => {
    const client = await seedQueryClient();
    const dehydrated = dehydrate(client, { shouldDehydrateQuery });
    const roots = dehydrated.queries.map((q) => q.queryKey[0]);
    expect(roots).toContain('trips');
    client.clear();
  });

  it('dehydrated set contains ["trip-places", "trip-1"] key', async () => {
    const client = await seedQueryClient();
    const dehydrated = dehydrate(client, { shouldDehydrateQuery });
    const roots = dehydrated.queries.map((q) => q.queryKey[0]);
    expect(roots).toContain('trip-places');
    client.clear();
  });

  it('does not dehydrate "place-details" key', async () => {
    const client = await seedQueryClient();
    const dehydrated = dehydrate(client, { shouldDehydrateQuery });
    const roots = dehydrated.queries.map((q) => q.queryKey[0]);
    expect(roots).not.toContain('place-details');
    client.clear();
  });

  it('does not dehydrate "places-autocomplete" key', async () => {
    const client = await seedQueryClient();
    const dehydrated = dehydrate(client, { shouldDehydrateQuery });
    const roots = dehydrated.queries.map((q) => q.queryKey[0]);
    expect(roots).not.toContain('places-autocomplete');
    client.clear();
  });
});
