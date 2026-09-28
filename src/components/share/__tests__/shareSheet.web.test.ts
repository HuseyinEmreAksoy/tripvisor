/**
 * shareSheet.web — Web Share API with clipboard fallback.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { buildAppUrl, shareLink } from '../shareSheet.web';

const mockCopy = jest.fn<(text: string) => Promise<boolean>>();
jest.mock('@/lib/clipboard', () => ({ copyToClipboard: (text: string) => mockCopy(text) }));

const INPUT = { url: 'https://tripvisor.test/share/abc', title: 'Lisbon', message: 'Look' };
type MutableNav = { share?: unknown; canShare?: unknown };
const nav = globalThis.navigator as unknown as MutableNav;

function setShare(fn: unknown) {
  Object.defineProperty(nav, 'share', { value: fn, configurable: true, writable: true });
}

beforeEach(() => {
  mockCopy.mockReset();
  mockCopy.mockResolvedValue(true);
});

afterEach(() => {
  delete nav.share;
  delete nav.canShare;
});

describe('shareLink (web)', () => {
  it('uses navigator.share when available', async () => {
    const share = jest.fn<(d: ShareData) => Promise<void>>().mockResolvedValue(undefined);
    setShare(share);
    await expect(shareLink(INPUT)).resolves.toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: 'Lisbon', text: 'Look', url: INPUT.url });
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('reports dismissed when the user closes the sheet', async () => {
    const abort = Object.assign(new Error('closed'), { name: 'AbortError' });
    setShare(jest.fn<() => Promise<void>>().mockRejectedValue(abort));
    await expect(shareLink(INPUT)).resolves.toBe('dismissed');
    expect(mockCopy).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when share is missing', async () => {
    await expect(shareLink(INPUT)).resolves.toBe('copied');
    expect(mockCopy).toHaveBeenCalledWith(INPUT.url);
  });

  it('falls back to the clipboard when share throws a non-abort error', async () => {
    setShare(jest.fn<() => Promise<void>>().mockRejectedValue(new Error('NotAllowedError')));
    await expect(shareLink(INPUT)).resolves.toBe('copied');
  });

  it('reports failed when copying fails too', async () => {
    mockCopy.mockResolvedValue(false);
    await expect(shareLink(INPUT)).resolves.toBe('failed');
  });
});

describe('buildAppUrl (web)', () => {
  it('uses the page origin', () => {
    const w = window as unknown as { location?: unknown };
    const original = w.location;
    Object.defineProperty(w, 'location', {
      value: { origin: 'https://tripvisor.pages.dev' },
      configurable: true,
      writable: true,
    });
    try {
      expect(buildAppUrl('/share/abc')).toEqual({
        url: 'https://tripvisor.pages.dev/share/abc',
        usingDeepLink: false,
      });
    } finally {
      Object.defineProperty(w, 'location', { value: original, configurable: true, writable: true });
    }
  });
});
