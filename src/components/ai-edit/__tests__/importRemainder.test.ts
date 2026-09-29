/** computeImportRemainder — names past the 30-name batch survive "Import more" (M5 F10 #4). */
import { describe, expect, it } from '@jest/globals';
import { MAX_IMPORT_BATCH, parseImportNames } from '@/lib/importParse';
import { computeImportRemainder } from '../importRemainder';

const names = (n: number, from = 1) =>
  Array.from({ length: n }, (_, i) => `Place number ${i + from}`);

describe('computeImportRemainder', () => {
  it('is empty when everything fits in one batch', () => {
    expect(computeImportRemainder(names(12).join('\n'))).toBe('');
  });

  it('returns names 31..50, which then parse as the next batch', () => {
    const text = names(50).join('\n');
    const rest = computeImportRemainder(text);
    const next = parseImportNames(rest);
    expect(next.names).toEqual(names(20, MAX_IMPORT_BATCH + 1));
    // Different batch → different intent signature → fresh idempotency key.
    expect(next.names[0]).not.toBe(parseImportNames(text).names[0]);
  });

  it('drops blank lines and duplicates of already-imported names from the rest', () => {
    const text = [...names(30), '', '- place number 3', ...names(2, 31)].join('\n');
    expect(parseImportNames(computeImportRemainder(text)).names).toEqual(names(2, 31));
  });
});
