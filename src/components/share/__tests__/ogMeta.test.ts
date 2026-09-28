/**
 * ogMeta — pure helpers behind the Pages Function share-link preview.
 */
import { describe, expect, it } from '@jest/globals';
import { buildShareOgMeta, escapeHtml, formatDateRange } from '../ogMeta';

describe('escapeHtml', () => {
  it('escapes markup and both quote styles', () => {
    expect(escapeHtml(`<script>"a" & 'b'</script>`)).toBe(
      '&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;',
    );
  });
});

describe('formatDateRange', () => {
  it('collapses a same-month range', () => {
    expect(formatDateRange('2026-06-12', '2026-06-18')).toBe('12–18 Jun 2026');
  });
  it('spans months and years', () => {
    expect(formatDateRange('2026-06-28', '2026-07-03')).toBe('28 Jun – 3 Jul 2026');
    expect(formatDateRange('2026-12-30', '2027-01-02')).toBe('30 Dec 2026 – 2 Jan 2027');
  });
  it('handles single and missing dates', () => {
    expect(formatDateRange('2026-06-12', null)).toBe('12 Jun 2026');
    expect(formatDateRange(null, null)).toBeNull();
    expect(formatDateRange('garbage', undefined)).toBeNull();
  });
});

describe('buildShareOgMeta', () => {
  it('builds title and description with dates and place count', () => {
    expect(buildShareOgMeta({ title: 'Lisbon', start_date: '2026-06-12', end_date: '2026-06-18' }, 9)).toEqual({
      title: 'Lisbon · Tripvisor',
      description: '12–18 Jun 2026 · 9 places — a read-only trip plan on Tripvisor. No sign-in needed.',
    });
  });
  it('falls back for untitled, undated, single-place trips', () => {
    const meta = buildShareOgMeta({ title: '  ' }, 1);
    expect(meta.title).toBe('Untitled trip · Tripvisor');
    expect(meta.description.startsWith('1 place — ')).toBe(true);
  });
});
