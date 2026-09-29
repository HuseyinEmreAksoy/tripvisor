// poi-recommend — interest-based recommendations from OpenStreetMap +
// Wikipedia (never Google). Contract, caching, fair-use and quota notes:
// ./handler.ts. ADR-0013. Client: src/api/recommendations.ts.
//
// verify_jwt: default (true), deliberately no supabase/config.toml entry;
// the handler also resolves the caller to a real user (requireUser).

// @ts-ignore -- Deno `.ts`-suffixed import (unresolvable under the Expo tsconfig)
import { createHandler } from './handler.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { supabaseDeps } from './deps.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
Deno.serve(createHandler(supabaseDeps()));
