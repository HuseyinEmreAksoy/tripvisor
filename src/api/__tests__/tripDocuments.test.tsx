/**
 * src/api/trip-documents.ts — filename sanitization, the metadata list, the
 * object-first upload protocol (with orphan cleanup), signed URLs and the
 * row-first delete with optimistic removal.
 *
 * `../supabase` is faked down to a recording PostgREST chain (`from()`), and
 * a `storage.from(bucket)` whose upload / remove / createSignedUrl are jest
 * fns.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ── mocks (hoisted) ──────────────────────────────────────────────────────
type MockResult = { data: unknown; error: unknown };
const mockCalls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
const mockResultFor = jest.fn<(table: string) => MockResult>();
const mockStorage = {
  buckets: [] as string[],
  upload: jest.fn<(path: string, body: unknown, opts: unknown) => Promise<MockResult>>(),
  remove: jest.fn<(paths: string[]) => Promise<MockResult>>(),
  createSignedUrl: jest.fn<(path: string, ttl: number) => Promise<MockResult>>(),
};

jest.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => {
      const rec = { table, ops: [] as Array<[string, unknown[]]> };
      mockCalls.push(rec);
      const result = mockResultFor(table);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'insert', 'delete', 'single']) {
        chain[m] = (...args: unknown[]) => {
          rec.ops.push([m, args]);
          return chain;
        };
      }
      chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    },
    storage: {
      from: (bucket: string) => {
        mockStorage.buckets.push(bucket);
        return {
          upload: (path: string, body: unknown, opts: unknown) => mockStorage.upload(path, body, opts),
          remove: (paths: string[]) => mockStorage.remove(paths),
          createSignedUrl: (path: string, ttl: number) => mockStorage.createSignedUrl(path, ttl),
        };
      },
    },
  },
}));

/* eslint-disable import/first */
import {
  MAX_DOCUMENT_BYTES,
  sanitizeFileName,
  tripDocumentsKeys,
  useDeleteTripDocument,
  useTripDocumentUrl,
  useTripDocuments,
  useUploadTripDocument,
  type TripDocument,
} from '../trip-documents';
/* eslint-enable import/first */

const TRIP = '00000000-0000-4000-8000-000000000001';
const DOC = '00000000-0000-4000-8000-0000000000d1';
const NOW = 1790000000000;

const doc = (extra: Partial<TripDocument> = {}): TripDocument => ({
  id: DOC,
  trip_id: TRIP,
  name: 'Tickets.pdf',
  storage_path: `${TRIP}/${NOW}_Tickets.pdf`,
  mime: 'application/pdf',
  size_bytes: 4,
  created_at: '2026-09-29T10:00:00Z',
  ...extra,
});

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
async function run<T>(fn: () => Promise<T>): Promise<T> {
  let out!: Promise<T>;
  await act(async () => {
    out = fn();
    await out.catch(() => undefined);
    await flush();
  });
  return out;
}

const clients: QueryClient[] = [];
function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  clients.push(client);
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const invalidatedKeys = () =>
    invalidate.mock.calls.map(([f]) => (f as { queryKey: unknown }).queryKey);
  return { client, wrapper, invalidate, invalidatedKeys };
}

beforeEach(() => {
  mockCalls.splice(0);
  mockResultFor.mockReset();
  mockStorage.buckets.splice(0);
  mockStorage.upload.mockReset();
  mockStorage.remove.mockReset();
  mockStorage.createSignedUrl.mockReset();
  mockStorage.upload.mockResolvedValue({ data: { path: 'x' }, error: null });
  mockStorage.remove.mockResolvedValue({ data: [], error: null });
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
});
afterEach(() => {
  clients.splice(0).forEach((c) => c.clear());
  jest.restoreAllMocks();
});

describe('sanitizeFileName', () => {
  it.each([
    ['Tickets.pdf', 'Tickets.pdf'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\Boarding pass (1).png', 'Boarding pass (1).png'],
    ['my   ticket?*.pdf', 'my ticket_.pdf'],
    ['İstanbul çay.jpg', '_stanbul _ay.jpg'],
    ['   ', 'file'],
    ['folder/', 'file'],
    ['', 'file'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('keeps the LAST 80 chars so the extension survives', () => {
    const out = sanitizeFileName(`${'a'.repeat(120)}.pdf`);
    expect(out).toHaveLength(80);
    expect(out.endsWith('.pdf')).toBe(true);
  });
});

describe('useTripDocuments', () => {
  it('lists metadata rows newest first', async () => {
    mockResultFor.mockReturnValue({ data: [doc()], error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripDocuments(TRIP), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual([doc()]);
    expect(mockCalls[0]!.table).toBe('trip_documents');
    expect(mockCalls[0]!.ops.slice(1)).toEqual([
      ['eq', ['trip_id', TRIP]],
      ['order', ['created_at', { ascending: false }]],
    ]);
  });

  it('surfaces errors and stays idle without a trip', async () => {
    const err = { message: 'boom' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    const a = setup();
    const bad = renderHook(() => useTripDocuments(TRIP), { wrapper: a.wrapper });
    await waitFor(() => expect(bad.result.current.isError).toBe(true));
    expect(bad.result.current.error).toBe(err);

    mockCalls.splice(0);
    const b = setup();
    const idle = renderHook(() => useTripDocuments(undefined), { wrapper: b.wrapper });
    await act(async () => {});
    expect(idle.result.current.fetchStatus).toBe('idle');
    expect(mockCalls).toHaveLength(0);
  });
});

describe('useUploadTripDocument', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;

  it('uploads the object first, then inserts the metadata row, then invalidates', async () => {
    mockResultFor.mockReturnValue({ data: doc(), error: null });
    const { wrapper, invalidatedKeys } = setup();
    const { result } = renderHook(() => useUploadTripDocument(), { wrapper });

    const out = await run(() =>
      result.current.mutateAsync({
        tripId: TRIP,
        file: { name: '  Tickets.pdf ', mime: 'application/pdf', bytes },
      }),
    );

    expect(out).toEqual(doc());
    expect(mockStorage.buckets[0]).toBe('trip-docs');
    const path = `${TRIP}/${NOW}_Tickets.pdf`;
    expect(mockStorage.upload).toHaveBeenCalledWith(path, bytes, {
      contentType: 'application/pdf',
      upsert: false,
    });
    expect(mockCalls[0]!.ops[0]).toEqual([
      'insert',
      [{ trip_id: TRIP, name: 'Tickets.pdf', storage_path: path, mime: 'application/pdf', size_bytes: 4 }],
    ]);
    expect(mockStorage.remove).not.toHaveBeenCalled();
    expect(invalidatedKeys()).toEqual([tripDocumentsKeys.forTrip(TRIP)]);
  });

  it('defaults the content type, nulls the mime and names blank files', async () => {
    mockResultFor.mockReturnValue({ data: doc({ name: 'Untitled document', mime: null }), error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useUploadTripDocument(), { wrapper });

    await run(() => result.current.mutateAsync({ tripId: TRIP, file: { name: '   ', bytes } }));

    expect(mockStorage.upload).toHaveBeenCalledWith(`${TRIP}/${NOW}_file`, bytes, {
      contentType: 'application/octet-stream',
      upsert: false,
    });
    const inserted = (mockCalls[0]!.ops[0]![1][0]) as Record<string, unknown>;
    expect(inserted).toMatchObject({ name: 'Untitled document', mime: null });
  });

  it('pre-flights the 10MB cap before uploading', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUploadTripDocument(), { wrapper });
    await expect(
      run(() =>
        result.current.mutateAsync({
          tripId: TRIP,
          file: { name: 'big.pdf', bytes: new ArrayBuffer(MAX_DOCUMENT_BYTES + 1) },
        }),
      ),
    ).rejects.toThrow('document_too_large');
    expect(mockStorage.upload).not.toHaveBeenCalled();
    expect(mockCalls).toHaveLength(0);
  });

  it('rejects a non-uuid trip id before any I/O', async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useUploadTripDocument(), { wrapper });
    await expect(
      run(() => result.current.mutateAsync({ tripId: 'nope', file: { name: 'a.pdf', bytes } })),
    ).rejects.toBeTruthy();
    expect(mockStorage.upload).not.toHaveBeenCalled();
  });

  it('surfaces an upload error without writing a row', async () => {
    const err = new Error('mime type not allowed');
    mockStorage.upload.mockResolvedValue({ data: null, error: err });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useUploadTripDocument(), { wrapper });
    await expect(
      run(() => result.current.mutateAsync({ tripId: TRIP, file: { name: 'a.exe', bytes } })),
    ).rejects.toBe(err);
    expect(mockCalls).toHaveLength(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('removes the just-uploaded object when the row insert fails', async () => {
    const err = { message: 'rls', code: '42501' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useUploadTripDocument(), { wrapper });
    await expect(
      run(() => result.current.mutateAsync({ tripId: TRIP, file: { name: 'a.pdf', bytes } })),
    ).rejects.toBe(err);
    expect(mockStorage.remove).toHaveBeenCalledWith([`${TRIP}/${NOW}_a.pdf`]);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('still surfaces the insert error when the cleanup itself throws', async () => {
    const err = { message: 'rls', code: '42501' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    mockStorage.remove.mockRejectedValue(new Error('network down'));
    const { wrapper } = setup();
    const { result } = renderHook(() => useUploadTripDocument(), { wrapper });
    await expect(
      run(() => result.current.mutateAsync({ tripId: TRIP, file: { name: 'a.pdf', bytes } })),
    ).rejects.toBe(err);
  });
});

describe('useTripDocumentUrl', () => {
  it('mints a 60s signed URL for the path', async () => {
    mockStorage.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripDocumentUrl(), { wrapper });
    const url = await run(() => result.current.mutateAsync({ storagePath: `${TRIP}/a.pdf` }));
    expect(url).toBe('https://signed/x');
    expect(mockStorage.createSignedUrl).toHaveBeenCalledWith(`${TRIP}/a.pdf`, 60);
  });

  it('surfaces a storage error, and a missing URL', async () => {
    const err = new Error('Object not found');
    mockStorage.createSignedUrl.mockResolvedValueOnce({ data: null, error: err });
    mockStorage.createSignedUrl.mockResolvedValueOnce({ data: {}, error: null });
    const { wrapper } = setup();
    const { result } = renderHook(() => useTripDocumentUrl(), { wrapper });
    await expect(run(() => result.current.mutateAsync({ storagePath: 'p' }))).rejects.toBe(err);
    await expect(run(() => result.current.mutateAsync({ storagePath: 'p' }))).rejects.toThrow(
      'createSignedUrl returned no URL',
    );
  });
});

describe('useDeleteTripDocument', () => {
  const other = doc({ id: '00000000-0000-4000-8000-0000000000d2', storage_path: `${TRIP}/2_b.pdf` });
  const key = tripDocumentsKeys.forTrip(TRIP);

  it('deletes the row first, then the object; optimistic removal; invalidates on settle', async () => {
    mockResultFor.mockReturnValue({ data: { id: DOC }, error: null });
    const { client, wrapper, invalidatedKeys } = setup();
    client.setQueryData(key, [doc(), other]);
    const { result } = renderHook(() => useDeleteTripDocument(), { wrapper });

    const out = await run(() =>
      result.current.mutateAsync({ documentId: DOC, tripId: TRIP, storagePath: doc().storage_path }),
    );

    expect(out).toEqual({ documentId: DOC });
    expect(mockCalls[0]!.ops).toEqual([
      ['delete', []],
      ['eq', ['id', DOC]],
      ['select', ['id']],
      ['single', []],
    ]);
    expect(mockStorage.remove).toHaveBeenCalledWith([doc().storage_path]);
    expect(client.getQueryData<TripDocument[]>(key)!.map((d) => d.id)).toEqual([other.id]);
    expect(invalidatedKeys()).toEqual([key]);
  });

  it('treats object-removal failure as best-effort success', async () => {
    mockResultFor.mockReturnValue({ data: { id: DOC }, error: null });
    mockStorage.remove.mockRejectedValue(new Error('network down'));
    const { wrapper } = setup();
    const { result } = renderHook(() => useDeleteTripDocument(), { wrapper });
    const out = await run(() =>
      result.current.mutateAsync({ documentId: DOC, tripId: TRIP, storagePath: 'p' }),
    );
    expect(out).toEqual({ documentId: DOC });
  });

  it('keeps the object and restores the list when the row delete is refused', async () => {
    const err = { message: 'no rows', code: 'PGRST116' };
    mockResultFor.mockReturnValue({ data: null, error: err });
    const { client, wrapper, invalidatedKeys } = setup();
    const before = [doc(), other];
    client.setQueryData(key, before);
    const { result } = renderHook(() => useDeleteTripDocument(), { wrapper });

    await expect(
      run(() => result.current.mutateAsync({ documentId: DOC, tripId: TRIP, storagePath: 'p' })),
    ).rejects.toBe(err);
    expect(mockStorage.remove).not.toHaveBeenCalled();
    expect(client.getQueryData(key)).toEqual(before);
    // onSettled invalidates on failure too.
    expect(invalidatedKeys()).toEqual([key]);
  });
});
