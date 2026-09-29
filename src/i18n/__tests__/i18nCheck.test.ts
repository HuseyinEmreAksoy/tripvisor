/**
 * Runs the `npm run i18n:check` gate inside Jest, so a missing Turkish key, an
 * unused key, a placeholder mismatch or a hard-coded string in a migrated
 * screen fails `npm test` (and CI) too — not only the reviewer's gate.
 */
import { describe, expect, it } from '@jest/globals';
import path from 'path';

// Plain CommonJS script shared with the npm entry point (scripts/i18n-check.js).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { runI18nCheck } = require('../../../scripts/i18n-check.js') as {
  runI18nCheck: (o: { root: string }) => { errors: string[]; stats: { keys: number; namespaces: number } };
};

describe('i18n:check', () => {
  it('has en/tr parity, no unused keys and no raw literals in migrated screens', () => {
    const { errors, stats } = runI18nCheck({ root: path.resolve(__dirname, '../../..') });
    expect(errors).toEqual([]);
    expect(stats.keys).toBeGreaterThan(0);
  }, 60_000);
});
