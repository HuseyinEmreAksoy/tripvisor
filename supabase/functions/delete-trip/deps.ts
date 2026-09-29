// delete-trip — supabase-js wiring for DeleteTripDeps (see handler.ts).
//
// Client choice per dependency:
//   authenticate / loadTrip / deleteTrip → makeUserClient(req): anon key +
//     the caller's JWT, so RLS stays the authority (`trips_collab_select` for
//     the read, `trips_owner_delete` for the delete).
//   bucket → makeAdminClient() (service role). Justification: the Storage
//     sweep after the row delete can no longer pass the caller's storage RLS
//     (it keys on a live trip), and cleanup must remove objects uploaded by
//     any collaborator. handler.ts only calls it for the `<tripId>/` prefix of
//     a trip the caller was just proven to own.

// @ts-ignore -- Deno `.ts`-suffixed import (unresolvable under the Expo tsconfig)
import { makeAdminClient, makeUserClient } from '../_shared/supabase-admin.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import type { BucketApi } from '../delete-account/storage-cleanup.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import type { DeleteTripDeps, TripOwnerRow } from './handler.ts';

function extractBearer(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? '';
  const m = /^Bearer\s+(.+)$/.exec(header);
  return m?.[1] ? m[1].trim() : null;
}

export function supabaseDeps(): DeleteTripDeps {
  let admin: ReturnType<typeof makeAdminClient> | null = null;
  const adminClient = () => (admin ??= makeAdminClient());

  return {
    async authenticate(req: Request): Promise<string | null> {
      const jwt = extractBearer(req);
      if (!jwt) return null;
      // getUser(jwt) round-trips to GoTrue: forged / expired / signed-out
      // tokens (and the bare anon key) come back as an error.
      const { data, error } = await makeUserClient(req).auth.getUser(jwt);
      if (error || !data?.user?.id) return null;
      return data.user.id as string;
    },

    async loadTrip(req: Request, tripId: string) {
      const { data, error } = await makeUserClient(req)
        .from('trips')
        .select('id, user_id')
        .eq('id', tripId)
        .maybeSingle();
      return { row: (data as TripOwnerRow | null) ?? null, error: error ? String(error.message) : null };
    },

    async deleteTrip(req: Request, tripId: string) {
      // `.select('id')` → Prefer: return=representation, so we learn how many
      // rows RLS actually let us delete (0 = already gone / refused).
      const { data, error } = await makeUserClient(req)
        .from('trips')
        .delete()
        .eq('id', tripId)
        .select('id');
      return {
        deleted: Array.isArray(data) ? data.length : 0,
        error: error ? String(error.message) : null,
      };
    },

    bucket(name: string): BucketApi {
      return adminClient().storage.from(name) as unknown as BucketApi;
    },
  };
}
