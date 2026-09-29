// fx-rates — cached daily exchange rates (Frankfurter/ECB) for multi-currency
// expenses. Contract, caching and quota notes: ./handler.ts. ADR-0012.
// Client: src/api/fx.ts (useFxRates / useFxCurrencies / fetchFxRate).
//
// verify_jwt: default (true), deliberately no supabase/config.toml entry;
// the handler also resolves the caller to a real user (requireUser).

// @ts-ignore -- Deno `.ts`-suffixed import (unresolvable under the Expo tsconfig)
import { createHandler } from './handler.ts';
// @ts-ignore -- Deno `.ts`-suffixed import
import { supabaseDeps } from './deps.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
Deno.serve(createHandler(supabaseDeps()));
