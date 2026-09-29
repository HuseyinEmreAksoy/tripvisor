/**
 * importRemainder — the part of the import textarea that did NOT make it into
 * the current ≤30-name batch, so "Import more" can pre-fill it and the next
 * Import grounds names 31-60 (instead of re-parsing the same first 30, which
 * would reuse the same idempotency key and replay "Already in this trip").
 *
 * Built on parseImportNames (src/lib/importParse.ts) so the batch boundary is
 * exactly the parser's: the rest starts at the first line whose inclusion
 * makes the parse `truncated`. Lines that normalize to a name already in the
 * batch are dropped (they would only be skipped as duplicates).
 */
import { parseImportNames } from '@/lib/importParse';

export function computeImportRemainder(text: string): string {
  const lines = text.split(/\r?\n/);
  if (!parseImportNames(text).truncated) return '';

  // `truncated` is monotonic in the prefix length → binary search the first
  // prefix (1..lines.length) that overflows the batch.
  let lo = 1;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (parseImportNames(lines.slice(0, mid).join('\n')).truncated) hi = mid;
    else lo = mid + 1;
  }
  const batch = new Set(
    parseImportNames(lines.slice(0, lo - 1).join('\n')).names.map((n) => n.toLowerCase()),
  );
  return lines
    .slice(lo - 1)
    .filter((line) => {
      const name = parseImportNames(line).names[0];
      return name !== undefined && !batch.has(name.toLowerCase());
    })
    .join('\n');
}
