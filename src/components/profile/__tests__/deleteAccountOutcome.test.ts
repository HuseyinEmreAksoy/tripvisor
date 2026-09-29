import { describe, expect, it } from '@jest/globals';
import { isAccountGoneError } from '../deleteAccountOutcome';

function httpError(status: number, body: unknown) {
  const res = {
    status,
    json: async () => body,
    clone() {
      return res;
    },
  };
  return { name: 'FunctionsHttpError', context: res };
}

describe('isAccountGoneError', () => {
  it('treats a 401 (user already deleted) as gone', async () => {
    await expect(
      isAccountGoneError(httpError(401, { error: { code: 'not_authorized', message: 'Invalid or expired token' } })),
    ).resolves.toBe(true);
  });

  it('treats "Account removed but data cleanup failed" as gone', async () => {
    await expect(
      isAccountGoneError(httpError(500, { error: { code: 'db_error', message: 'Account removed but data cleanup failed' } })),
    ).resolves.toBe(true);
  });

  it('keeps real failures as failures', async () => {
    await expect(
      isAccountGoneError(httpError(500, { error: { code: 'admin_error', message: 'Failed to delete account' } })),
    ).resolves.toBe(false);
    await expect(isAccountGoneError({ name: 'FunctionsFetchError', context: new Error('offline') })).resolves.toBe(false);
    await expect(isAccountGoneError(null)).resolves.toBe(false);
    await expect(
      isAccountGoneError({ context: { status: 500, json: async () => { throw new Error('bad json'); } } }),
    ).resolves.toBe(false);
  });
});
