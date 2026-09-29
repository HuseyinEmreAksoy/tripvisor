// memories-sweep — hourly removal of orphaned `trip-memories` Storage objects
// (objects with no trip_photos row). Contract, auth and service-role
// justification: ./handler.ts. Scheduled by migration 0039 (pg_cron + pg_net
// + Vault). Not called by the app.
//
// verify_jwt: default (true), deliberately no supabase/config.toml entry;
// the handler additionally requires the sweep secret or the service-role key.

// @ts-ignore -- Deno `.ts`-suffixed import (unresolvable under the Expo tsconfig)
import { handler } from './handler.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
Deno.serve(handler);
