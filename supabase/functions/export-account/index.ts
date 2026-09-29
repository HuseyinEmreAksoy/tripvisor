// export-account — flat JSON dump of the caller's own data (ADR-0009, +M5
// memories per ADR-0014). Contract and security notes: ./handler.ts.
// Client: src/api/account-export.shared.ts.
//
// verify_jwt: default (true).

// @ts-ignore -- Deno `.ts`-suffixed import (unresolvable under the Expo tsconfig)
import { handler } from './handler.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
Deno.serve(handler);
