/**
 * ShareLinkCard — component unit tests.
 *
 * Covers create → URL/Share/Copy/Revoke, the share-sheet call, the revoke
 * confirmation (cancel keeps the link), and revoke clearing local state.
 * API hooks, clipboard, confirm and the platform share helper are mocked at
 * the module boundary ("mock"-prefixed so babel-jest allows them in factories).
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ShareLinkCard } from '../ShareLinkCard';
import { ThemeProvider } from '@/theme';

const mockCreateMutateAsync = jest.fn<() => Promise<{ token: string }>>();
const mockRevokeMutateAsync = jest.fn<(input?: { token?: string }) => Promise<{ revoked: number }>>();
const mockConfirm = jest.fn<() => Promise<boolean>>();
const mockShareLink = jest.fn<(input: { url: string; title: string; message: string }) => Promise<string>>();

jest.mock('@/api/share', () => ({
  useCreateShareLink: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false, isError: false }),
  useRevokeShareLink: () => ({ mutateAsync: mockRevokeMutateAsync, isPending: false, isError: false }),
}));

jest.mock('@/lib/clipboard', () => ({
  copyToClipboard: () => Promise.resolve(true),
}));

jest.mock('@/lib/confirm', () => ({
  confirmDestructive: () => mockConfirm(),
}));

jest.mock('../share/shareSheet', () => ({
  shareLink: (input: { url: string; title: string; message: string }) => mockShareLink(input),
  buildAppUrl: (path: string) => ({ url: `https://tripvisor.test/${path}`, usingDeepLink: false }),
}));

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

const TRIP_ID = 'trip-123';
const TOKEN = 'abc123token456def';
const CREATE = { name: /create a read-only share link/i };

async function createLink() {
  const utils = wrap(<ShareLinkCard tripId={TRIP_ID} tripTitle="Lisbon long weekend" />);
  fireEvent.press(utils.getByRole('button', CREATE));
  await utils.findByText(new RegExp(`/share/${TOKEN}`));
  return utils;
}

beforeEach(() => {
  mockCreateMutateAsync.mockReset();
  mockRevokeMutateAsync.mockReset();
  mockConfirm.mockReset();
  mockShareLink.mockReset();
  mockCreateMutateAsync.mockResolvedValue({ token: TOKEN });
  mockRevokeMutateAsync.mockResolvedValue({ revoked: 1 });
  mockConfirm.mockResolvedValue(true);
  mockShareLink.mockResolvedValue('shared');
});

afterEach(() => {
  jest.clearAllTimers();
});

describe('ShareLinkCard — before create', () => {
  it('renders "Create share link" button initially', () => {
    const { getByRole } = wrap(<ShareLinkCard tripId={TRIP_ID} />);
    expect(getByRole('button', CREATE)).toBeTruthy();
  });

  it('does not show Share, Copy or Revoke before create', () => {
    const { queryByRole, queryByText } = wrap(<ShareLinkCard tripId={TRIP_ID} />);
    expect(queryByRole('button', { name: /share the public trip link/i })).toBeNull();
    expect(queryByRole('button', { name: /copy share link/i })).toBeNull();
    expect(queryByRole('button', { name: /revoke share link/i })).toBeNull();
    expect(queryByText(/\/share\//)).toBeNull();
  });

  it('keeps the invite-collaborator entry point', () => {
    const { getByRole } = wrap(<ShareLinkCard tripId={TRIP_ID} />);
    expect(getByRole('button', { name: /manage collaborators/i })).toBeTruthy();
  });
});

describe('ShareLinkCard — after successful create', () => {
  it('shows the URL plus Share, Copy and Revoke; hides Create', async () => {
    const { getByRole, queryByRole } = await createLink();
    expect(getByRole('button', { name: /share the public trip link/i })).toBeTruthy();
    expect(getByRole('button', { name: /copy share link/i })).toBeTruthy();
    expect(getByRole('button', { name: /revoke share link/i })).toBeTruthy();
    expect(queryByRole('button', CREATE)).toBeNull();
  });

  it('opens the share sheet with the public URL and trip title', async () => {
    const { getByRole } = await createLink();
    fireEvent.press(getByRole('button', { name: /share the public trip link/i }));
    await waitFor(() => expect(mockShareLink).toHaveBeenCalledTimes(1));
    const arg = mockShareLink.mock.calls[0]![0];
    expect(arg.url).toBe(`https://tripvisor.test/share/${TOKEN}`);
    expect(arg.title).toMatch(/Lisbon long weekend/);
  });

  it('announces "Link copied" when sharing fell back to the clipboard', async () => {
    mockShareLink.mockResolvedValue('copied');
    const { getByRole, findByText } = await createLink();
    fireEvent.press(getByRole('button', { name: /share the public trip link/i }));
    expect(await findByText(/link copied to clipboard/i)).toBeTruthy();
  });
});

describe('ShareLinkCard — revoke', () => {
  it('asks for confirmation and keeps the link when cancelled', async () => {
    mockConfirm.mockResolvedValue(false);
    const { getByRole, getByText } = await createLink();
    fireEvent.press(getByRole('button', { name: /revoke share link/i }));
    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
    expect(mockRevokeMutateAsync).not.toHaveBeenCalled();
    expect(getByText(new RegExp(`/share/${TOKEN}`))).toBeTruthy();
  });

  it('revokes after confirmation and shows Create again', async () => {
    const { getByRole, queryByText } = await createLink();
    fireEvent.press(getByRole('button', { name: /revoke share link/i }));
    await waitFor(() => expect(mockRevokeMutateAsync).toHaveBeenCalledWith({ token: TOKEN }));
    await waitFor(() => expect(queryByText(new RegExp(`/share/${TOKEN}`))).toBeNull());
    expect(getByRole('button', CREATE)).toBeTruthy();
  });
});
