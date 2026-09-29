/**
 * Security audit 2026-09-29 #3 — client side of signed place-photo URLs.
 *
 * Covers the pure pieces of src/api/place-photos.ts plus the batching
 * fallback signer and the hook's public contract (`{ url }`, unchanged
 * signature so no component had to change).
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockInvoke = jest.fn<(...args: unknown[]) => Promise<{ data: unknown; error: unknown }>>();
jest.mock('../supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => mockInvoke(...a) } } }));

// The module reads EXPO_PUBLIC_SUPABASE_URL once at load time, so set it
// before requiring (static imports would be hoisted above this line).
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'public-anon';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const photos = require('../place-photos') as typeof import('../place-photos');
const {
  _resetPlacePhotoStateForTests,
  buildPlacePhotoUrl,
  lookupPhotoSignature,
  registerPhotoSignatures,
  requestPhotoSignature,
  snapPhotoWidth,
  usePlacePhotoUrl,
} = photos;

const NAME = 'places/ChIJabc/photos/ref_1';
const nowS = () => Math.floor(Date.now() / 1000);

beforeEach(() => {
  _resetPlacePhotoStateForTests();
  mockInvoke.mockReset();
});

describe('snapPhotoWidth (mirror of the server rule)', () => {
  it('snaps up to 200/400/800/1600 and clamps', () => {
    expect(snapPhotoWidth(100)).toBe(200);
    expect(snapPhotoWidth(400)).toBe(400);
    expect(snapPhotoWidth(600)).toBe(800);
    expect(snapPhotoWidth(1601)).toBe(1600);
    expect(snapPhotoWidth(9999)).toBe(1600);
  });
  it('defaults garbage to 400', () => {
    expect(snapPhotoWidth(undefined)).toBe(400);
    expect(snapPhotoWidth(0)).toBe(400);
    expect(snapPhotoWidth(Number.NaN)).toBe(400);
  });
});

describe('signature registry', () => {
  it('stores place-details signatures and returns the one for the width', () => {
    const exp = nowS() + 12 * 3600;
    registerPhotoSignatures([{ name: NAME, signature: { exp, sig: { '200': 'a', '400': 'b' } } }]);
    expect(lookupPhotoSignature(NAME, 400)).toEqual({ exp, sig: 'b' });
    expect(lookupPhotoSignature(NAME, 200)).toEqual({ exp, sig: 'a' });
    expect(lookupPhotoSignature(NAME, 800)).toBeNull();
  });

  it('ignores photos without a signature (older server / secret unset)', () => {
    registerPhotoSignatures([{ name: NAME }]);
    registerPhotoSignatures(undefined);
    expect(lookupPhotoSignature(NAME, 400)).toBeNull();
  });

  it('treats a signature in its last 10 minutes as expired', () => {
    registerPhotoSignatures([{ name: NAME, signature: { exp: nowS() + 5 * 60, sig: { '400': 'x' } } }]);
    expect(lookupPhotoSignature(NAME, 400)).toBeNull();
  });

  it('never downgrades to an older expiry bucket', () => {
    const newer = nowS() + 20 * 3600;
    const older = nowS() + 13 * 3600;
    registerPhotoSignatures([{ name: NAME, signature: { exp: newer, sig: { '400': 'new' } } }]);
    registerPhotoSignatures([{ name: NAME, signature: { exp: older, sig: { '400': 'old' } } }]);
    expect(lookupPhotoSignature(NAME, 400)).toEqual({ exp: newer, sig: 'new' });
  });
});

describe('buildPlacePhotoUrl', () => {
  it('carries photoName, snapped width, exp and sig (and the public apikey for the gateway)', () => {
    const url = buildPlacePhotoUrl('https://x.supabase.co', NAME, 800, { exp: 123, sig: 's-_' }, 'anon');
    const u = new URL(url);
    expect(u.pathname).toBe('/functions/v1/place-photo');
    expect(u.searchParams.get('photoName')).toBe(NAME);
    expect(u.searchParams.get('maxWidthPx')).toBe('800');
    expect(u.searchParams.get('exp')).toBe('123');
    expect(u.searchParams.get('sig')).toBe('s-_');
    expect(u.searchParams.get('apikey')).toBe('anon');
  });
});

describe('requestPhotoSignature (fallback signer)', () => {
  it('coalesces concurrent asks into ONE batched POST place-photo', async () => {
    const exp = nowS() + 12 * 3600;
    mockInvoke.mockResolvedValue({
      data: {
        photos: [
          { name: NAME, maxWidthPx: 400, exp, sig: 's1' },
          { name: 'places/ChIJabc/photos/ref_2', maxWidthPx: 200, exp, sig: 's2' },
        ],
      },
      error: null,
    });
    await Promise.all([
      requestPhotoSignature(NAME, 400),
      requestPhotoSignature(NAME, 400), // duplicate shares the in-flight promise
      requestPhotoSignature('places/ChIJabc/photos/ref_2', 200),
    ]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('place-photo', {
      body: {
        photos: [
          { name: NAME, maxWidthPx: 400 },
          { name: 'places/ChIJabc/photos/ref_2', maxWidthPx: 200 },
        ],
      },
    });
    expect(lookupPhotoSignature(NAME, 400)).toEqual({ exp, sig: 's1' });
  });

  it('rejects on error (e.g. 429 quota) and backs off instead of re-asking', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('quota_exceeded') });
    await expect(requestPhotoSignature(NAME, 400)).rejects.toBeTruthy();
    await expect(requestPhotoSignature(NAME, 400)).rejects.toThrow('photo_sign_backoff');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});

describe('usePlacePhotoUrl', () => {
  it('returns { url: null } for no photo name, without any request', () => {
    const { result } = renderHook(() => usePlacePhotoUrl(null, { maxWidthPx: 400 }));
    expect(result.current).toEqual({ url: null });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('builds the signed URL synchronously from a place-details signature (no request)', () => {
    const exp = nowS() + 12 * 3600;
    registerPhotoSignatures([{ name: NAME, signature: { exp, sig: { '200': 'sig200' } } }]);
    // 100 snaps up to 200 (PlaceRow / CoverPicker thumbnails).
    const { result } = renderHook(() => usePlacePhotoUrl(NAME, { maxWidthPx: 100 }));
    const url = result.current.url;
    expect(url).not.toBeNull();
    const u = new URL(url!);
    expect(u.searchParams.get('maxWidthPx')).toBe('200');
    expect(u.searchParams.get('sig')).toBe('sig200');
    expect(u.searchParams.get('exp')).toBe(String(exp));
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('falls back to the signer when no signature is known, then yields the URL', async () => {
    const exp = nowS() + 12 * 3600;
    mockInvoke.mockResolvedValue({
      data: { photos: [{ name: NAME, maxWidthPx: 800, exp, sig: 'late' }] },
      error: null,
    });
    const { result } = renderHook(() => usePlacePhotoUrl(NAME, { maxWidthPx: 600 }));
    expect(result.current.url).toBeNull();
    await waitFor(() => expect(result.current.url).not.toBeNull());
    expect(new URL(result.current.url!).searchParams.get('sig')).toBe('late');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('stays null (placeholder) when signing fails, with no retry loop', async () => {
    mockInvoke.mockResolvedValue({ data: null, error: new Error('boom') });
    const { result, rerender } = renderHook(() => usePlacePhotoUrl(NAME, { maxWidthPx: 400 }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    rerender({});
    expect(result.current.url).toBeNull();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});
