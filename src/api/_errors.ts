/**
 * Shared error hierarchy for typed Edge Function failures.
 *
 * Why this file exists
 * --------------------
 * Two parallel error classes evolved across phases:
 *   - `OptimizeError` in `src/api/routes.ts` (Phase 16, optimize-trip codes)
 *   - `PlacesError`   in `src/api/places.ts` (Phase 20 Step 3, places-* codes)
 *
 * Both:
 *   1. carry a `code: string` (well-known, stable, listed in the per-Edge
 *      Function index.ts),
 *   2. carry a `status: number` (the HTTP status the Edge Function returned),
 *   3. extend `Error` so `instanceof` works at consumer sites,
 *   4. parse the `{ error: { code, message } }` envelope from
 *      `supabase.functions.invoke`'s `FunctionsHttpError.context` (the
 *      Response object) the same way.
 *
 * Generalising into one base class let us:
 *   - share the envelope-parser helper (one tested code path, not two),
 *   - keep `instanceof OptimizeError` / `instanceof PlacesError` checks at
 *     consumer sites unchanged (subclasses preserve their `.name` and
 *     identity),
 *   - reuse the same shape for any future Edge Functions (`directions-*`,
 *     `distance-matrix`, etc.) — Phase 21 has at least one more candidate.
 *
 * Subclass policy
 * ---------------
 * Subclasses MUST set `this.name` in their constructor so error tooling
 * (Sentry, console traces, JSON serializers) reports the concrete class
 * rather than the base "EdgeFunctionError". Subclasses don't add fields
 * today; the union of `code` strings is enough to discriminate behaviour.
 */

/**
 * Base class for typed Edge Function failures.
 *
 * Direct consumers should normally branch on a subclass (`OptimizeError`,
 * `PlacesError`, ...) so the discriminated `code` set is narrowed. Use
 * `instanceof EdgeFunctionError` only for cross-cutting concerns (e.g. a
 * top-level error boundary that wants to render any Edge Function failure
 * with the same banner).
 */
export class EdgeFunctionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'EdgeFunctionError';
  }
}

/**
 * Best-effort parser for the structured `{ error: { code, message } }`
 * envelope on a non-2xx Edge Function response. Returns an instance of
 * `Ctor` (an `EdgeFunctionError` subclass) when the envelope is well-formed,
 * otherwise returns null and the caller should rethrow the original error
 * as-is.
 *
 * Shared by `places.ts` and `routes.ts` so the parsing logic for the
 * envelope shape lives in one place. New Edge Function consumers should
 * pass their subclass constructor and reuse this helper.
 */
export async function tryParseEdgeFunctionError<E extends EdgeFunctionError>(
  invokeError: unknown,
  Ctor: new (code: string, message: string, status: number) => E,
): Promise<E | null> {
  const ctx = (invokeError as { context?: unknown }).context;
  if (
    !ctx ||
    typeof ctx !== 'object' ||
    !('status' in ctx) ||
    typeof (ctx as { status: unknown }).status !== 'number' ||
    !('json' in ctx) ||
    typeof (ctx as { json: unknown }).json !== 'function'
  ) {
    return null;
  }
  try {
    const response = ctx as Response;
    const body: unknown = await response.json();
    if (
      body &&
      typeof body === 'object' &&
      'error' in body &&
      body.error &&
      typeof body.error === 'object' &&
      'code' in body.error &&
      typeof (body.error as { code: unknown }).code === 'string'
    ) {
      const env = body.error as { code: string; message?: unknown };
      const fallbackMessage =
        invokeError instanceof Error ? invokeError.message : 'Edge function error';
      const message =
        typeof env.message === 'string' && env.message.length > 0
          ? env.message
          : fallbackMessage;
      return new Ctor(env.code, message, response.status);
    }
  } catch {
    // JSON parse / shape mismatch — fall through.
  }
  return null;
}
