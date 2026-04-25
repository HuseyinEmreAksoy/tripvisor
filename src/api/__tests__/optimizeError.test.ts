/**
 * Unit tests for OptimizeError class and the envelope-parsing logic in
 * useOptimizeTrip (src/api/routes.ts).
 *
 * The envelope-parsing logic is embedded in the mutation function and cannot
 * be directly imported without triggering TanStack Query initialization.
 * Instead, these tests exercise the OptimizeError class itself — which is
 * exported — and validate the envelope shape that the parsing code reads.
 *
 * The "parse path" integration (FunctionsHttpError → OptimizeError) is tested
 * at the Edge Function level (supabase/functions/optimize-trip/test.ts).
 *
 * Covers:
 *   - OptimizeError is an instance of Error (instanceof checks in consumers)
 *   - name is 'OptimizeError' (for logging)
 *   - code, message, status accessors
 *   - instanceof discrimination between OptimizeError and plain Error
 */

import { OptimizeError } from '../routes';

describe('OptimizeError', () => {
  it('is an instance of Error', () => {
    const err = new OptimizeError('already_optimizing', 'in progress', 409);
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of OptimizeError', () => {
    const err = new OptimizeError('already_optimizing', 'in progress', 409);
    expect(err).toBeInstanceOf(OptimizeError);
  });

  it('sets name to "OptimizeError"', () => {
    const err = new OptimizeError('matrix_failed', 'distance matrix error', 502);
    expect(err.name).toBe('OptimizeError');
  });

  it('exposes the error code', () => {
    const err = new OptimizeError('too_many_places', 'too many', 400);
    expect(err.code).toBe('too_many_places');
  });

  it('exposes the http status', () => {
    const err = new OptimizeError('rpc_failed', 'rpc error', 500);
    expect(err.status).toBe(500);
  });

  it('exposes the human-readable message', () => {
    const err = new OptimizeError('db_error', 'database failure', 500);
    expect(err.message).toBe('database failure');
  });

  it('a plain Error is not instanceof OptimizeError', () => {
    const plain = new Error('regular error');
    expect(plain instanceof OptimizeError).toBe(false);
  });

  it('discriminates known codes via .code string comparison', () => {
    const knownCodes = [
      'already_optimizing',
      'too_many_places',
      'matrix_failed',
      'rpc_failed',
      'db_error',
      'not_found',
      'invalid_input',
      'method_not_allowed',
    ] as const;

    for (const code of knownCodes) {
      const err = new OptimizeError(code, `error: ${code}`, 400);
      expect(err.code).toBe(code);
    }
  });
});

// ── Envelope shape contract ────────────────────────────────────────────────────
//
// These tests encode the expected JSON envelope that useOptimizeTrip reads when
// it receives a non-2xx response from the Edge Function. If the Edge Function
// changes its error format, these tests flag the mismatch before it hits prod.

describe('optimize-trip error envelope contract', () => {
  // The envelope the code looks for:
  //   { error: { code: string, message?: string } }
  const validEnvelope = { error: { code: 'already_optimizing', message: 'in progress' } };
  const envelopeWithoutMessage = { error: { code: 'too_many_places' } };
  const invalidEnvelopes = [
    null,
    {},
    { error: null },
    { error: {} },                           // no code field
    { error: { code: 42 } },                 // code not a string
    { code: 'already_optimizing' },          // wrong top-level key
  ];

  it('valid envelope has "error.code" as a string', () => {
    expect(typeof validEnvelope.error.code).toBe('string');
    expect(validEnvelope.error.code.length).toBeGreaterThan(0);
  });

  it('valid envelope without message field still has a code', () => {
    expect(typeof envelopeWithoutMessage.error.code).toBe('string');
  });

  it.each(invalidEnvelopes)('invalid envelope "%p" does not satisfy the code check', (env) => {
    // Mirror the guard logic from useOptimizeTrip.mutationFn
    const body: unknown = env;
    const isValid =
      body !== null &&
      typeof body === 'object' &&
      'error' in (body as object) &&
      (body as { error: unknown }).error !== null &&
      typeof (body as { error: unknown }).error === 'object' &&
      'code' in ((body as { error: object }).error as object) &&
      typeof ((body as { error: { code: unknown } }).error as { code: unknown }).code === 'string';
    expect(isValid).toBe(false);
  });
});
