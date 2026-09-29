// delete-trip — owner-only hard delete of one trip, including its Storage
// objects. Contract, order of operations and security notes: ./handler.ts.
// Client: src/api/trips.ts `useDeleteTrip`.
//
// verify_jwt: default (true) — deliberately no supabase/config.toml entry.

// @ts-ignore -- Deno `.ts`-suffixed import (unresolvable under the Expo tsconfig)
import { createHandler } from './handler.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { supabaseDeps } from './deps.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
Deno.serve(createHandler(supabaseDeps()));
