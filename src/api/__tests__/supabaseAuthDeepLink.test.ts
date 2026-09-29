/**
 * F11-1: native magic-link / Google OAuth redirects (tripvisor:///?code=…)
 * are exchanged for a session — auth-js's detectSessionInUrl is browser-only.
 */
import { afterAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockListeners: Array<(e: { url: string }) => void> = [];
let mockInitialUrl: string | null = null;

jest.mock('expo-linking', () => ({
  addEventListener: jest.fn((_type: string, cb: (e: { url: string }) => void) => {
    mockListeners.push(cb);
    return { remove: jest.fn() };
  }),
  getInitialURL: jest.fn(async () => mockInitialUrl),
  createURL: jest.fn(() => 'tripvisor:///'),
}));

type Mod = typeof import('../supabase');

const loaded: Mod[] = [];

/** jest-expo runs as a native platform (Platform.OS !== 'web'). */
function load(): Mod {
  let mod!: Mod;
  jest.isolateModules(() => {
    mod = require('../supabase');
  });
  loaded.push(mod);
  return mod;
}

afterAll(async () => {
  // auth-js starts an auto-refresh ticker per client; stop them so jest exits.
  for (const m of loaded) await m.supabase.auth.stopAutoRefresh();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  mockListeners.length = 0;
  mockInitialUrl = null;
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('parseAuthCallbackUrl', () => {
  it('reads the code from the query and errors from the fragment', () => {
    const { parseAuthCallbackUrl } = load();
    expect(parseAuthCallbackUrl('tripvisor:///?code=abc-123')).toEqual({ code: 'abc-123', error: null });
    expect(parseAuthCallbackUrl('tripvisor:///#error=access_denied&error_description=Email+link+is+invalid')).toEqual({
      code: null,
      error: 'Email link is invalid',
    });
    expect(parseAuthCallbackUrl('tripvisor:///')).toEqual({ code: null, error: null });
  });
});

describe('completeAuthFromUrl / native handler', () => {
  it('exchanges the launch URL code once, and later url events', async () => {
    const mod = load();
    const exchange = jest
      .spyOn(mod.supabase.auth, 'exchangeCodeForSession')
      .mockResolvedValue({ data: { session: null, user: null }, error: null } as never);
    mockInitialUrl = 'tripvisor:///?code=first';
    mod.installNativeAuthDeepLinkHandler();
    await flush();
    expect(exchange).toHaveBeenCalledWith('first');

    // The same link delivered again as a url event is not re-exchanged (single-use code).
    mockListeners[0]!({ url: 'tripvisor:///?code=first' });
    mockListeners[0]!({ url: 'tripvisor:///?code=second' });
    await flush();
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(exchange).toHaveBeenLastCalledWith('second');
  });

  it('reports errors without throwing and ignores links without a code', async () => {
    const mod = load();
    const exchange = jest
      .spyOn(mod.supabase.auth, 'exchangeCodeForSession')
      .mockResolvedValue({ data: { session: null, user: null }, error: new Error('bad code') } as never);
    await expect(mod.completeAuthFromUrl('tripvisor:///trip/1')).resolves.toBe('none');
    await expect(mod.completeAuthFromUrl('tripvisor:///#error_description=expired')).resolves.toBe('error');
    await expect(mod.completeAuthFromUrl('tripvisor:///?code=x')).resolves.toBe('error');
    expect(exchange).toHaveBeenCalledTimes(1);
  });

});
