/**
 * src/api/account-export.shared.ts — the platform-agnostic pre-download
 * pipeline (invoke → envelope validation → pretty JSON → UTC filename →
 * exact UTF-8 byte count).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// ── mocks (hoisted) ──────────────────────────────────────────────────────
type InvokeResult = { data: unknown; error: { message?: string } | null };
const mockInvoke = jest.fn<(name: string, opts: unknown) => Promise<InvokeResult>>();

jest.mock('../supabase', () => ({
  supabase: {
    functions: { invoke: (name: string, opts: unknown) => mockInvoke(name, opts) },
  },
}));

/* eslint-disable import/first */
import { fetchAccountExportJson } from '../account-export.shared';
/* eslint-enable import/first */

beforeEach(() => {
  mockInvoke.mockReset();
  jest.useFakeTimers({ now: new Date('2026-09-29T23:30:00Z') });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('fetchAccountExportJson', () => {
  it('POSTs export-account and returns pretty JSON, a UTC-dated filename and the byte count', async () => {
    const exportPayload = { trips: [{ id: 't1', name: 'Rome' }], profile: { email: 'a@b.c' } };
    mockInvoke.mockResolvedValue({ data: { ok: true, export: exportPayload }, error: null });

    const out = await fetchAccountExportJson();

    expect(mockInvoke).toHaveBeenCalledWith('export-account', { method: 'POST' });
    // Only the `export` object is serialised (not the ok/envelope), 2-space indent.
    expect(out.json).toBe(JSON.stringify(exportPayload, null, 2));
    expect(out.json).toContain('\n  "trips": [');
    expect(out.filename).toBe('tripvisor-export-2026-09-29.json');
    expect(out.bytes).toBe(out.json.length); // pure ASCII → 1 byte per char
  });

  it('counts UTF-8 bytes (not UTF-16 code units) for non-ASCII content', async () => {
    const exportPayload = { trips: [{ notes: 'İstanbul çay ☕' }] };
    mockInvoke.mockResolvedValue({ data: { ok: true, export: exportPayload }, error: null });

    const out = await fetchAccountExportJson();

    expect(out.bytes).toBe(Buffer.byteLength(out.json, 'utf8'));
    expect(out.bytes).toBeGreaterThan(out.json.length);
  });

  it('throws the invocation error message', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: 'Failed to send a request' } });
    await expect(fetchAccountExportJson()).rejects.toThrow('Failed to send a request');
  });

  it('falls back to a generic message when the invocation error has none', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: {} });
    await expect(fetchAccountExportJson()).rejects.toThrow('export-account invocation failed');
  });

  it.each([
    ['null data', null],
    ['ok !== true', { ok: false, export: { trips: [] } }],
    ['ok truthy but not true', { ok: 'yes', export: { trips: [] } }],
    ['missing export', { ok: true }],
    ['export not an object', { ok: true, export: 'nope' }],
    ['trips not an array', { ok: true, export: { trips: {} } }],
  ])('rejects an invalid envelope (%s)', async (_label, data) => {
    mockInvoke.mockResolvedValue({ data, error: null });
    await expect(fetchAccountExportJson()).rejects.toThrow('Invalid export response shape');
  });
});
