/**
 * importParse — pure parsing helpers for the "Import places" flow
 * (v2 Phase N4 step 4.3).
 *
 * Two inputs feed the import textarea:
 *   - pasted free text ("one place per line — or paste a list")
 *   - a Google Takeout saved-places CSV (web only; we read its Title column)
 *
 * Both are normalized client-side into ≤30 trimmed names per batch before
 * hitting `useGroundPlaces` (the ai-edit `ground` action validates 1..30
 * names, each 2..120 chars — see supabase/functions/ai-edit/README.md).
 *
 * Pure + framework-free + no imports, so it's trivially unit-testable
 * (mirrors computeDayTimeline.ts).
 */

/** Server-side batch ceiling for the `ground` action (names: 1..30). */
export const MAX_IMPORT_BATCH = 30;

/** Server-side per-name length window (each name 2..120 chars). */
export const MAX_IMPORT_NAME_LENGTH = 120;

export interface ParsedImportNames {
  /** Cleaned, deduped names, capped at {@link MAX_IMPORT_BATCH}. */
  names: string[];
  /** Lines skipped as empty-after-cleanup, too short (<2 chars), or duplicates. */
  skipped: number;
  /** True when valid names beyond the 30-name batch cap were left behind. */
  truncated: boolean;
}

/**
 * Parse pasted text into groundable place names.
 *
 * Per line: strips common list decorations (`- `, `* `, `• `, `1. `, `1) `),
 * trims, clips to 120 chars, drops empties and <2-char leftovers, dedupes
 * case-insensitively, and caps the batch at 30 (`truncated` flags overflow
 * so the UI can say "first 30 this batch").
 */
export function parseImportNames(text: string): ParsedImportNames {
  const seen = new Set<string>();
  const names: string[] = [];
  let skipped = 0;
  let truncated = false;

  for (const rawLine of text.split(/\r?\n/)) {
    // Strip leading bullets / numbering, then trim.
    const cleaned = rawLine.replace(/^\s*(?:[-*•·–—]|\d{1,3}[.)])\s+/, '').trim();
    if (cleaned.length === 0) continue; // blank lines aren't worth counting
    const clipped =
      cleaned.length > MAX_IMPORT_NAME_LENGTH
        ? cleaned.slice(0, MAX_IMPORT_NAME_LENGTH).trim()
        : cleaned;
    if (clipped.length < 2) {
      skipped += 1;
      continue;
    }
    const key = clipped.toLowerCase();
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    if (names.length >= MAX_IMPORT_BATCH) {
      truncated = true;
      break;
    }
    seen.add(key);
    names.push(clipped);
  }

  return { names, skipped, truncated };
}

/**
 * Minimal RFC-4180-ish CSV parser: handles quoted cells, escaped quotes
 * (`""`), commas and newlines inside quotes, and both LF / CRLF rows.
 * Deliberately dependency-free (plan-v2 N4.3: "no new dependency").
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  const pushRow = () => {
    row.push(cell);
    cell = '';
    // Skip rows that are entirely empty (e.g. a trailing newline).
    if (row.length > 1 || (row[0] ?? '') !== '') rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text.charAt(i);
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i += 1;
      pushRow();
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  pushRow();

  return rows;
}

/**
 * Extract the `Title` column from a Google Takeout saved-places CSV
 * (header row: `Title,Note,URL`). Returns `[]` when there is no Title
 * column — the caller should tell the user this doesn't look like a
 * Takeout export rather than guessing at another column.
 */
export function parseTakeoutCsvTitles(csv: string): string[] {
  const rows = parseCsv(csv);
  const header = rows[0];
  if (!header) return [];
  const titleCol = header.findIndex((c) => c.trim().toLowerCase() === 'title');
  if (titleCol === -1) return [];

  const titles: string[] = [];
  for (let r = 1; r < rows.length; r += 1) {
    const cell = rows[r]?.[titleCol];
    if (!cell) continue;
    const trimmed = cell.trim();
    if (trimmed) titles.push(trimmed);
  }
  return titles;
}
