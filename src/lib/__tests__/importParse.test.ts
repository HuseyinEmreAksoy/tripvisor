/**
 * importParse.ts — pasted-text + Google Takeout CSV parsing for "Import places".
 */
import { describe, expect, it } from '@jest/globals';
import {
  MAX_IMPORT_BATCH,
  MAX_IMPORT_NAME_LENGTH,
  parseCsv,
  parseImportNames,
  parseTakeoutCsvTitles,
} from '../importParse';

describe('parseImportNames', () => {
  it('splits on LF and CRLF and trims each line', () => {
    const r = parseImportNames('  Eiffel Tower  \nLouvre\r\nMusée d’Orsay\r\n');
    expect(r).toEqual({ names: ['Eiffel Tower', 'Louvre', 'Musée d’Orsay'], skipped: 0, truncated: false });
  });

  it('strips common bullet and numbering decorations', () => {
    const text = [
      '- Hagia Sophia',
      '* Blue Mosque',
      '• Topkapi Palace',
      '· Galata Tower',
      '– Basilica Cistern',
      '— Grand Bazaar',
      '1. Dolmabahce Palace',
      '12) Spice Bazaar',
      '   3. Indented Place',
    ].join('\n');
    expect(parseImportNames(text).names).toEqual([
      'Hagia Sophia',
      'Blue Mosque',
      'Topkapi Palace',
      'Galata Tower',
      'Basilica Cistern',
      'Grand Bazaar',
      'Dolmabahce Palace',
      'Spice Bazaar',
      'Indented Place',
    ]);
  });

  it('only strips a decoration followed by whitespace (keeps hyphenated / numeric names)', () => {
    const r = parseImportNames('-Hyphen Start\n1.5 Km Beach\n2001 Odyssey Cafe');
    expect(r.names).toEqual(['-Hyphen Start', '1.5 Km Beach', '2001 Odyssey Cafe']);
  });

  it('does not count blank / whitespace-only / bullet-only lines as skipped', () => {
    const r = parseImportNames('\n   \nRome\n-   \n\t\nMilan\n');
    expect(r).toEqual({ names: ['Rome', 'Milan'], skipped: 0, truncated: false });
  });

  it('skips (and counts) names shorter than 2 chars', () => {
    const r = parseImportNames('A\n- B\nOK');
    expect(r.names).toEqual(['OK']);
    expect(r.skipped).toBe(2);
  });

  it('dedupes case-insensitively, keeping the first spelling, and counts duplicates', () => {
    const r = parseImportNames('Paris\nPARIS\n- paris\nLyon\nlyon');
    expect(r.names).toEqual(['Paris', 'Lyon']);
    expect(r.skipped).toBe(3);
    expect(r.truncated).toBe(false);
  });

  it('clips long names to MAX_IMPORT_NAME_LENGTH and trims the clipped tail', () => {
    const long = 'x'.repeat(MAX_IMPORT_NAME_LENGTH + 50);
    expect(parseImportNames(long).names).toEqual(['x'.repeat(MAX_IMPORT_NAME_LENGTH)]);

    // Char 120 lands on a space → the clipped result is trimmed to 119.
    const spaced = `${'y'.repeat(MAX_IMPORT_NAME_LENGTH - 1)} tail tail tail`;
    const [clipped] = parseImportNames(spaced).names;
    expect(clipped).toBe('y'.repeat(MAX_IMPORT_NAME_LENGTH - 1));
  });

  it('dedupes on the CLIPPED name', () => {
    const base = 'z'.repeat(MAX_IMPORT_NAME_LENGTH);
    const r = parseImportNames(`${base}AAA\n${base}BBB`);
    expect(r.names).toEqual([base]);
    expect(r.skipped).toBe(1);
  });

  it('caps the batch at MAX_IMPORT_BATCH and flags truncation', () => {
    const lines = Array.from({ length: MAX_IMPORT_BATCH + 5 }, (_, i) => `Place ${i + 1}`);
    const r = parseImportNames(lines.join('\n'));
    expect(r.names).toHaveLength(MAX_IMPORT_BATCH);
    expect(r.names[0]).toBe('Place 1');
    expect(r.names[MAX_IMPORT_BATCH - 1]).toBe(`Place ${MAX_IMPORT_BATCH}`);
    expect(r.truncated).toBe(true);
    expect(r.skipped).toBe(0);
  });

  it('exactly MAX_IMPORT_BATCH names is not truncated; trailing duplicates/blanks do not truncate either', () => {
    const lines = Array.from({ length: MAX_IMPORT_BATCH }, (_, i) => `Spot ${i + 1}`);
    const r = parseImportNames([...lines, '', 'spot 1', 'X'].join('\n'));
    expect(r.names).toHaveLength(MAX_IMPORT_BATCH);
    expect(r.truncated).toBe(false);
    expect(r.skipped).toBe(2);
  });

  it('returns an empty result for empty input', () => {
    expect(parseImportNames('')).toEqual({ names: [], skipped: 0, truncated: false });
  });

  it('exposes the server-side limits', () => {
    expect(MAX_IMPORT_BATCH).toBe(30);
    expect(MAX_IMPORT_NAME_LENGTH).toBe(120);
  });
});

describe('parseCsv', () => {
  it('parses simple rows with LF', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('parses CRLF rows and lone CR rows', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a,b\r1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles quoted cells containing commas, newlines and escaped quotes', () => {
    const csv = 'Title,Note\n"Café, Paris","line1\nline2"\n"He said ""hi""",x';
    expect(parseCsv(csv)).toEqual([
      ['Title', 'Note'],
      ['Café, Paris', 'line1\nline2'],
      ['He said "hi"', 'x'],
    ]);
  });

  it('keeps empty cells, including trailing ones', () => {
    expect(parseCsv('a,,c\n,,\nx,')).toEqual([
      ['a', '', 'c'],
      ['', '', ''],
      ['x', ''],
    ]);
  });

  it('drops entirely empty rows (blank lines, trailing newline)', () => {
    expect(parseCsv('a\n\n\nb\n')).toEqual([['a'], ['b']]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\r\n')).toEqual([]);
  });

  it('drops a row whose only cell is a quoted empty string', () => {
    expect(parseCsv('""\nx')).toEqual([['x']]);
  });

  it('tolerates an unterminated quote by consuming to end of input', () => {
    expect(parseCsv('a,"open\nstill open')).toEqual([['a', 'open\nstill open']]);
  });
});

describe('parseTakeoutCsvTitles', () => {
  it('extracts the Title column from a Takeout saved-places export', () => {
    const csv = [
      'Title,Note,URL',
      'Colosseum,,https://maps.google.com/?cid=1',
      '"Trevi Fountain","coins!",https://maps.google.com/?cid=2',
      '',
    ].join('\r\n');
    expect(parseTakeoutCsvTitles(csv)).toEqual(['Colosseum', 'Trevi Fountain']);
  });

  it('finds the Title column wherever it is, case- and whitespace-insensitively', () => {
    const csv = 'URL, TITLE ,Note\nhttp://a,  Pantheon  ,n\nhttp://b,Vatican,';
    expect(parseTakeoutCsvTitles(csv)).toEqual(['Pantheon', 'Vatican']);
  });

  it('skips missing, empty and whitespace-only titles', () => {
    const csv = 'Note,Title\nonly-note\nx,\ny,   \nz,Spanish Steps';
    expect(parseTakeoutCsvTitles(csv)).toEqual(['Spanish Steps']);
  });

  it('returns [] when there is no Title column', () => {
    expect(parseTakeoutCsvTitles('Name,Address\nFoo,Bar')).toEqual([]);
  });

  it('returns [] for empty input and a header-only file', () => {
    expect(parseTakeoutCsvTitles('')).toEqual([]);
    expect(parseTakeoutCsvTitles('Title,Note,URL\n')).toEqual([]);
  });

  it('tolerates a UTF-8 BOM before the header (String#trim strips U+FEFF)', () => {
    expect(parseTakeoutCsvTitles('﻿Title,Note\nAcropolis,')).toEqual(['Acropolis']);
  });

  it('keeps titles with embedded commas and quotes intact', () => {
    const csv = 'Title\n"Bar ""Da Mario"", Trastevere"';
    expect(parseTakeoutCsvTitles(csv)).toEqual(['Bar "Da Mario", Trastevere']);
  });
});
