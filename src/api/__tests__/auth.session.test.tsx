/**
 * Auth lifecycle seam (src/api/auth.ts): single listener, offline-safe
 * session, native PKCE deep-link exchange, offline sign-out fallback.
 */
import React from 'react';
import { beforeEach, expect, jest, test } from '@jest/globals';
import { renderHook, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthRetryableFetchError } from '@supabase/supabase-js';

/** Loose async test double: each test resolves the auth-js shape it needs. */
type AsyncMock = (...args: unknown[]) => Promise<unknown>;

const mockAuth = {
  onAuthStateChange: jest.fn(() => ({ data: { subscription: { unsubscribe: jest.fn() } } })),
  getSession: jest.fn<AsyncMock>(),
  exchangeCodeForSession: jest.fn<AsyncMock>(),
  signOut: jest.fn<AsyncMock>(),
  storageKey: 'sb-test-auth-token',
};
jest.mock('../supabase', () => ({
  supabase: {
    get auth() {
      return mockAuth;
    },
  },
}));
const mockGetItem = jest.fn<(key: string) => Promise<string | null>>();
jest.mock('../storage', () => ({ storageAdapter: { getItem: (k: string) => mockGetItem(k) } }), {
  virtual: true,
});
const mockInit = jest.fn(() => Promise.resolve());
const mockTeardown = jest.fn();
jest.mock('@/sync/hydrate', () => ({
  initTier1Sync: (...a: unknown[]) => mockInit(...(a as [])),
  teardownTier1Sync: () => mockTeardown(),
}));
const mockStartUploads = jest.fn();
const mockStopUploads = jest.fn();
jest.mock('../memories.upload-queue', () => ({
  startPhotoUploads: (id: string) => mockStartUploads(id),
  stopPhotoUploads: () => mockStopUploads(),
}));
jest.mock('expo-linking', () => ({
  createURL: () => 'tripvisor://',
  getInitialURL: jest.fn(() => Promise.resolve(null)),
  addEventListener: jest.fn(() => ({ remove: jest.fn() })),
}));

import {
  __resetAuthModuleForTests,
  handleAuthCallbackUrl,
  handleAuthStateChange,
  useSession,
  useSignOut,
} from '../auth';

const session = (id = 'u1') =>
  ({ access_token: 'a', refresh_token: 'r', user: { id } }) as never;

function wrapper(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetAuthModuleForTests();
});

test('many useSession consumers register ONE auth listener; lifecycle runs once per user', async () => {
  mockAuth.getSession.mockResolvedValue({ data: { session: session() }, error: null });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const w = wrapper(qc);
  const a = renderHook(() => useSession(), { wrapper: w });
  renderHook(() => useSession(), { wrapper: w });
  renderHook(() => useSession(), { wrapper: w });
  await waitFor(() => expect(a.result.current.data).toBeTruthy());
  expect(mockAuth.onAuthStateChange).toHaveBeenCalledTimes(1);
  act(() => {
    handleAuthStateChange('INITIAL_SESSION', session());
    handleAuthStateChange('TOKEN_REFRESHED', session());
  });
  expect(mockInit).toHaveBeenCalledTimes(1);
  expect(mockStartUploads).toHaveBeenCalledTimes(1);
});

test('offline refresh failure keeps the persisted session; INITIAL_SESSION(null) does not sign out', async () => {
  mockAuth.getSession.mockResolvedValue({
    data: { session: null },
    error: new AuthRetryableFetchError('Failed to fetch', 0),
  });
  mockGetItem.mockResolvedValue(JSON.stringify(session('u9')));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => useSession(), { wrapper: wrapper(qc) });
  await waitFor(() => expect(result.current.data?.user.id).toBe('u9'));
  expect(mockGetItem).toHaveBeenCalledWith('sb-test-auth-token');
  act(() => handleAuthStateChange('INITIAL_SESSION', null));
  expect(result.current.data?.user.id).toBe('u9');
  expect(mockTeardown).not.toHaveBeenCalled();
  act(() => handleAuthStateChange('SIGNED_OUT', null));
  await waitFor(() => expect(result.current.data).toBeNull());
  expect(mockTeardown).toHaveBeenCalledTimes(1);
});

test('native deep link with ?code= is exchanged once; error params surface', async () => {
  mockAuth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  await expect(handleAuthCallbackUrl('tripvisor://?code=XYZ')).resolves.toBe(true);
  await handleAuthCallbackUrl('tripvisor://?code=XYZ');
  expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledWith('XYZ');
  await expect(handleAuthCallbackUrl('tripvisor://trip/1')).resolves.toBe(false);
  await expect(
    handleAuthCallbackUrl('tripvisor://?error=access_denied&error_description=Link+expired'),
  ).resolves.toBe(true);
  expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
});

test('sign-out falls back to local scope when the global logout fails offline', async () => {
  mockAuth.signOut
    .mockResolvedValueOnce({ error: new AuthRetryableFetchError('Failed to fetch', 0) })
    .mockResolvedValueOnce({ error: null });
  const qc = new QueryClient();
  const { result } = renderHook(() => useSignOut(), { wrapper: wrapper(qc) });
  await act(async () => {
    await result.current.mutateAsync();
  });
  expect(mockAuth.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
  // TanStack batches observer notifications on a timer, so the hook re-renders
  // with the settled state after act() returns.
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
});
