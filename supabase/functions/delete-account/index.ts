// delete-account — irreversibly delete the caller's account and all their
// data (rows + Storage objects). Contract, order of operations and security
// notes: ./handler.ts. Client: the Settings screen's "Delete account" flow.
//
// verify_jwt: default (true).

// @ts-ignore -- Deno `.ts`-suffixed import (unresolvable under the Expo tsconfig)
import { handler } from './handler.ts';

// @ts-ignore -- `Deno` global is unknown to the Expo tsconfig
Deno.serve(handler);
