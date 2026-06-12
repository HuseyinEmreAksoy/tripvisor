/**
 * rank.ts — fractional-index ranking for `trip_places.manual_rank`
 * (v2 S2.6 primitive; C1 refinement: user-intent order).
 *
 * `manual_rank` is a lexicographic TEXT key: sorting rows by plain string
 * comparison of their ranks yields the user's hand-ordered sequence. To move
 * a row, write ONE new key strictly between its new neighbors — no other
 * row is touched, which is exactly what makes offline drag LWW-safe (two
 * clients reordering different rows offline never collide on the same
 * column of the same row).
 *
 * Algorithm: classic base-62 lexicographic-midpoint fractional indexing.
 * Keys are non-empty strings over the alphabet 0-9 < A-Z < a-z (ASCII order
 * — so Postgres `text` comparison with the default C-ish collation and JS
 * `<` agree; the 0027 migration stores manual_rank as plain text).
 *
 * Invariants this module maintains (and why):
 *   - Generated keys NEVER end in '0' (the minimum digit). A key ending in
 *     '0' creates an empty range — nothing sorts strictly between 'a' and
 *     'a0' — which would make a later insert-before impossible.
 *   - `a < rankBetween(a, b) < b` for every valid input pair (the ordering
 *     invariant; property-tested in __tests__/rank.test.ts).
 *   - Exhaustion degrades by SUFFIXING, not failing: append after 'z' yields
 *     'zV', between adjacent 'a0'/'a1' yields 'a0V', … keys grow ~1 char per
 *     bisection of an already-tight gap. Rank strings stay short in practice
 *     because each optimize/AI-apply pass may rewrite a trip's ranks wholesale.
 *
 * PURE: no I/O, no store access, no Date/random. Shared by the mutation
 * layer (src/sync/mutations.ts) and Wave 3b's drag path.
 */

/** Base-62 digits in ASCII order — '0' (min) … 'z' (max). */
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length; // 62

/** Index of the middle digit ('V') — the seed key for an empty list. */
const MID = BASE >> 1; // 31

/** Thrown on malformed keys or genuinely empty ranges (see rankBetween docs). */
export class RankError extends Error {
  constructor(message: string) {
    super(`[sync.rank] ${message}`);
    this.name = 'RankError';
  }
}

function digitIndex(ch: string): number {
  const i = ALPHABET.indexOf(ch);
  if (i === -1) throw new RankError(`invalid rank digit "${ch}" (allowed: 0-9, A-Z, a-z)`);
  return i;
}

function validateKey(key: string, side: 'a' | 'b'): void {
  if (key.length === 0) throw new RankError(`rank "${side}" must be a non-empty string or null`);
  for (let i = 0; i < key.length; i++) digitIndex(key.charAt(i));
}

/**
 * Midpoint of the open interval (a, b) where `a` may be '' (= the virtual
 * minimum, below every non-empty key) and `b === null` is the virtual
 * maximum (above every key). Precondition: a < b lexicographically (with ''
 * below everything and null above everything).
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    // Recurse past the common prefix — the answer must carry it verbatim.
    let n = 0;
    while (n < a.length && n < b.length && a.charAt(n) === b.charAt(n)) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
    if (b.length === 0) {
      // Only reachable when an ancestor call exhausted b down to '' while a
      // is at/above the floor — i.e. the open interval is EMPTY. Happens
      // exactly when the original b ends in '0' digits right after the
      // shared prefix (e.g. between 'a' and 'a0'). This module never
      // generates such keys; a foreign key that does is a caller bug.
      throw new RankError('empty range: no key sorts strictly between the given ranks');
    }
  }

  if (a.length === 0) {
    if (b === null) return ALPHABET.charAt(MID); // seed key for an empty list: 'V'
    const db = digitIndex(b.charAt(0));
    // A single digit strictly below b's first digit exists iff db >= 2
    // (we never return the '0' digit alone — trailing-'0' invariant).
    if (db >= 2) return ALPHABET.charAt(db >> 1);
    // b starts with '0' or '1': every key below b must start with '0'.
    // For '1…' anything '0'-prefixed works; for '0…' recurse into the rest.
    return ALPHABET.charAt(0) + (db === 0 ? midpoint('', b.slice(1)) : midpoint('', null));
  }

  const da = digitIndex(a.charAt(0));
  const db = b === null ? BASE : digitIndex(b.charAt(0));
  if (db - da >= 2) {
    // A whole digit fits between the first digits — emit the single-char
    // midpoint. (da < mid < db, and mid >= 1, so never a bare '0'.)
    return ALPHABET.charAt((da + db) >> 1);
  }
  // First digits are adjacent: every valid answer starts with a's first
  // digit (it stays < b because b's first digit is strictly larger), so the
  // problem reduces to "strictly after a's remainder, unbounded above".
  // This is the suffixing path: append-after-'z' lands here ('z' + 'V').
  return a.charAt(0) + midpoint(a.slice(1), null);
}

/**
 * A key strictly between `a` and `b` under plain string comparison.
 *
 *   - `rankBetween(null, null)`  → 'V'        (first key in an empty list)
 *   - `rankBetween(k, null)`     → append after k (e.g. 'z' → 'zV')
 *   - `rankBetween(null, k)`     → prepend before k
 *   - `rankBetween(a, b)`        → insert between neighbors (e.g. 'a0','a1' → 'a0V')
 *
 * Throws {@link RankError} on: malformed keys (empty / non-base-62), a >= b,
 * or a genuinely empty range (only possible with foreign keys ending in '0',
 * which this module never generates).
 */
export function rankBetween(a: string | null, b: string | null): string {
  if (a !== null) validateKey(a, 'a');
  if (b !== null) validateKey(b, 'b');
  if (a !== null && b !== null && a >= b) {
    throw new RankError(`rank "a" (${a}) must sort strictly before rank "b" (${b})`);
  }
  return midpoint(a ?? '', b);
}
