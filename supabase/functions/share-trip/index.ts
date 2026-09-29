// share-trip — public read-only share links for a trip: create / read /
// revoke, plus the owner's per-link toggles and "current link" read (M5
// Y2.5). Contract, security model and error codes: ./handler.ts; the public
// payload allow-lists and contract versions: ./public-fields.ts.
//
// verify_jwt: default (true). Anonymous viewers call `op: "read"` with the
// public anon key; every other op requires the trip OWNER's session.

// @ts-ignore -- Deno `.ts`-suffixed import (unresolvable under the Expo tsconfig)
import { handler } from './handler.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
Deno.serve(handler);
