/**
 * ShareLinkCard — component unit tests.
 *
 * Covers:
 *   - Before create: shows "Create share link" button
 *   - After create resolves with { token }: shows the URL, Copy, and Revoke buttons
 *   - Revoke clears local state — URL no longer visible
 *
 * useCreateShareLink + useRevokeShareLink are mocked at the module boundary.
 * Variables in jest.mock() factories must be prefixed with "mock" to bypass
 * babel-jest's out-of-scope variable restriction.
 */
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ShareLinkCard } from '../ShareLinkCard';
import { ThemeProvider } from '@/theme';

// Stable mock implementations — prefixed "mock" so babel-jest allows them in factory
const mockCreateMutateAsync = jest.fn();
const mockRevokeMutateAsync = jest.fn();

jest.mock('@/api/share', () => ({
  useCreateShareLink: () => ({
    mutateAsync: mockCreateMutateAsync,
    isPending: false,
    isError: false,
  }),
  useRevokeShareLink: () => ({
    mutateAsync: mockRevokeMutateAsync,
    isPending: false,
    isError: false,
  }),
}));

jest.mock('@/lib/clipboard', () => ({
  copyToClipboard: jest.fn().mockResolvedValue(true),
}));

// ---- Helpers ----------------------------------------------------------------

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

const TRIP_ID = 'trip-123';
const TOKEN = 'abc123token456def';

// ---- Tests ------------------------------------------------------------------

describe('ShareLinkCard — before create', () => {
  beforeEach(() => {
    mockCreateMutateAsync.mockClear();
    mockRevokeMutateAsync.mockClear();
  });

  it('renders "Create share link" button initially', () => {
    const { getByRole } = wrap(<ShareLinkCard tripId={TRIP_ID} />);
    expect(getByRole('button', { name: /create a read-only share link/i })).toBeTruthy();
  });

  it('does not show Copy or Revoke buttons before create', () => {
    const { queryByRole } = wrap(<ShareLinkCard tripId={TRIP_ID} />);
    expect(queryByRole('button', { name: /copy share link/i })).toBeNull();
    expect(queryByRole('button', { name: /revoke share link/i })).toBeNull();
  });

  it('does not show a URL before create', () => {
    const { queryByText } = wrap(<ShareLinkCard tripId={TRIP_ID} />);
    expect(queryByText(/\/share\//)).toBeNull();
  });
});

describe('ShareLinkCard — after successful create', () => {
  beforeEach(() => {
    mockCreateMutateAsync.mockResolvedValue({ token: TOKEN });
    mockRevokeMutateAsync.mockClear();
  });

  afterEach(() => {
    mockCreateMutateAsync.mockClear();
  });

  it('shows the share URL containing the token after create', async () => {
    const { getByRole, findByText } = wrap(<ShareLinkCard tripId={TRIP_ID} />);
    fireEvent.press(getByRole('button', { name: /create a read-only share link/i }));
    const urlNode = await findByText(new RegExp(`/share/${TOKEN}`));
    expect(urlNode).toBeTruthy();
  });

  it('shows Copy link button after create', async () => {
    const { getByRole, findByRole } = wrap(<ShareLinkCard tripId={TRIP_ID} />);
    fireEvent.press(getByRole('button', { name: /create a read-only share link/i }));
    const copyBtn = await findByRole('button', { name: /copy share link/i });
    expect(copyBtn).toBeTruthy();
  });

  it('shows Revoke link button after create', async () => {
    const { getByRole, findByRole } = wrap(<ShareLinkCard tripId={TRIP_ID} />);
    fireEvent.press(getByRole('button', { name: /create a read-only share link/i }));
    const revokeBtn = await findByRole('button', { name: /revoke share link/i });
    expect(revokeBtn).toBeTruthy();
  });

  it('hides Create button after create', async () => {
    const { getByRole, findByText, queryByRole } = wrap(<ShareLinkCard tripId={TRIP_ID} />);
    fireEvent.press(getByRole('button', { name: /create a read-only share link/i }));
    await findByText(new RegExp(`/share/${TOKEN}`));
    expect(queryByRole('button', { name: /create a read-only share link/i })).toBeNull();
  });
});

describe('ShareLinkCard — revoke clears state', () => {
  beforeEach(() => {
    mockCreateMutateAsync.mockResolvedValue({ token: TOKEN });
    mockRevokeMutateAsync.mockResolvedValue({ revoked: 1 });
  });

  afterEach(() => {
    mockCreateMutateAsync.mockClear();
    mockRevokeMutateAsync.mockClear();
  });

  it('clears the URL after revoke', async () => {
    const { getByRole, findByRole, queryByText } = wrap(<ShareLinkCard tripId={TRIP_ID} />);
    fireEvent.press(getByRole('button', { name: /create a read-only share link/i }));
    const revokeBtn = await findByRole('button', { name: /revoke share link/i });
    fireEvent.press(revokeBtn);
    await waitFor(() => {
      expect(queryByText(new RegExp(`/share/${TOKEN}`))).toBeNull();
    });
  });

  it('shows Create button again after revoke', async () => {
    const { getByRole, findByRole } = wrap(<ShareLinkCard tripId={TRIP_ID} />);
    fireEvent.press(getByRole('button', { name: /create a read-only share link/i }));
    const revokeBtn = await findByRole('button', { name: /revoke share link/i });
    fireEvent.press(revokeBtn);
    await waitFor(() => {
      expect(getByRole('button', { name: /create a read-only share link/i })).toBeTruthy();
    });
  });

  it('calls useRevokeShareLink mutateAsync when Revoke pressed', async () => {
    const { getByRole, findByRole } = wrap(<ShareLinkCard tripId={TRIP_ID} />);
    fireEvent.press(getByRole('button', { name: /create a read-only share link/i }));
    const revokeBtn = await findByRole('button', { name: /revoke share link/i });
    fireEvent.press(revokeBtn);
    await waitFor(() => {
      expect(mockRevokeMutateAsync).toHaveBeenCalledTimes(1);
    });
  });
});
