// Tripvisor Phase 10 — shared pre-download work for account data export.
//
// Why this file is shared (no `.web.` / `.native.` suffix):
//   Both `account-export.web.ts` (Blob + anchor) and `account-export.native.ts`
//   (`expo-file-system` + `expo-sharing`) need the same pre-download pipeline:
//     1. Invoke the Edge Function and surface auth/network errors.
//     2. Validate the response shape at the wrapper boundary (the rows came
//        from Postgres types we already trust, so we only narrow the
//        top-level structure — not every field of every row).
//     3. Stringify the JSON with a 2-space indent for human-readable output.
//     4. Compute a deterministic UTC filename and a byte count.
//   Centralizing this in `account-export.shared.ts` means the platform files
//   stay focused on the file-handle / sharing mechanic and we don't drift the
//   filename or validation logic. The naming convention (no platform suffix)
//   keeps Metro / RN-Web from accidentally picking it up as a platform file.
//
// Why UTC date for the filename:
//   `Date.prototype.toISOString().slice(0, 10)` is the canonical
//   `YYYY-MM-DD` representation in UTC. UTC is deterministic across clients —
//   two users running the export at the same instant get the same filename,
//   regardless of their local zone. A user in a late-evening timezone could
//   see "tomorrow's" date in the filename; that's an acceptable trade-off
//   versus the alternative of locale-dependent filenames.
//
// What this helper does NOT do:
//   - No `expo-file-system`, no `URL.createObjectURL`, no DOM. Pure
//     TypeScript + the existing `supabase` client. Platform mechanics live
//     in the `.web.ts` / `.native.ts` siblings.

import { supabase } from './supabase';

/**
 * Pre-download artifact: the JSON body, a deterministic UTC filename, and a
 * byte count for telemetry / UI.
 */
export interface AccountExportFile {
  /** Pretty-printed JSON (2-space indent) of the `export` object. */
  json: string;
  /** `tripvisor-export-YYYY-MM-DD.json` (UTC). */
  filename: string;
  /**
   * UTF-8 byte count of `json`. Computed via `new Blob([json]).size` when
   * available, else `json.length` as a UTF-8-byte approximation. The
   * approximation is close-enough for telemetry and UI affordances; it's not
   * used for any contract-bearing decision.
   */
  bytes: number;
}

/**
 * Invoke the `export-account` Edge Function, validate the top-level shape,
 * and return the JSON string + filename + byte count ready for a
 * platform-specific download mechanic.
 *
 * Throws on:
 *   - `supabase.functions.invoke` error (network / auth).
 *   - Response shape that doesn't match the expected `{ ok: true, export: {...
 *     trips: Trip[] ... } }` envelope.
 */
export async function fetchAccountExportJson(): Promise<AccountExportFile> {
  const { data, error } = await supabase.functions.invoke('export-account', {
    method: 'POST',
  });

  if (error) {
    // Mirror the `useDeleteAccount` pattern — throw so the calling
    // `useMutation` surfaces it via `onError`.
    throw new Error(error.message ?? 'export-account invocation failed');
  }

  // Narrow shape validation. We trust row contents because Postgres typed them;
  // we just confirm the envelope is there.
  const exportPayload = (data as { ok?: unknown; export?: unknown } | null | undefined)?.export;
  const ok = (data as { ok?: unknown } | null | undefined)?.ok === true;
  if (
    !ok ||
    !exportPayload ||
    typeof exportPayload !== 'object' ||
    !Array.isArray((exportPayload as { trips?: unknown }).trips)
  ) {
    throw new Error('Invalid export response shape');
  }

  const json = JSON.stringify(exportPayload, null, 2);

  // UTC date — deterministic, see file-level note above.
  const filename = `tripvisor-export-${new Date().toISOString().slice(0, 10)}.json`;

  // Exact UTF-8 byte count via TextEncoder (Phase 10 L2 fix). Universal in
  // modern web + RN/Hermes; no Blob feature-detection branch. Replaces the
  // earlier Blob+fallback approach which undercounted UTF-8 for non-ASCII
  // notes (accents, emoji, CJK).
  const bytes = new TextEncoder().encode(json).length;

  return { json, filename, bytes };
}
