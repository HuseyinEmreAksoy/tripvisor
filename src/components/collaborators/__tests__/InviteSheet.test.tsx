/**
 * InviteSheet — invite failure copy (2026-09-29 security follow-up, audit
 * #14 invite quotas). The manage-collaborators 429/503 codes get our own
 * copy; unknown failures still fall back to the server message.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { InviteSheet, inviteErrorMessage, type InviteSheetProps } from '../InviteSheet';

jest.mock('@/api/trip-collaborators', () => {
  class CollaboratorError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return { CollaboratorError };
});
jest.mock('@/components/share', () => ({
  useShareAction: () => ({ share: jest.fn(), sharing: false, feedback: null }),
}));
jest.mock('@/lib/clipboard', () => ({ copyToClipboard: () => Promise.resolve(true) }));

const { CollaboratorError: MockCollaboratorError } = jest.requireMock<{
  CollaboratorError: new (code: string, message: string, status: number) => Error;
}>('@/api/trip-collaborators');

describe('inviteErrorMessage', () => {
  it.each([
    ['invite_rate_limited', 429, "You've sent a lot of invites today — try again tomorrow"],
    ['trip_invite_limit', 429, 'This trip has too many pending invites — cancel some first'],
    ['quota_unavailable', 503, 'Invites are temporarily unavailable'],
    [
      'already_invited',
      409,
      'This person already has an invite for this trip. Cancel it first to send a new one.',
    ],
  ])('%s → our copy, not the English server message', (code, status, copy) => {
    expect(inviteErrorMessage(new MockCollaboratorError(code, 'server text', status))).toBe(copy);
  });

  it('falls back to the error message, then a generic line', () => {
    expect(inviteErrorMessage(new MockCollaboratorError('db_error', 'Database hiccup', 500))).toBe(
      'Database hiccup',
    );
    expect(inviteErrorMessage('boom')).toBe('Could not send invite. Please try again.');
  });
});

describe('InviteSheet', () => {
  it('shows the rate-limit copy when the invite is rejected with 429', async () => {
    const mutateAsync = jest.fn(() =>
      Promise.reject(new MockCollaboratorError('invite_rate_limited', 'Daily invite limit reached', 429)),
    );
    const inviteMutation = { mutateAsync, isPending: false } as unknown as InviteSheetProps['inviteMutation'];
    const { getByLabelText, getByRole, findByText } = render(
      <ThemeProvider>
        <InviteSheet tripId="trip-1" tripTitle="Lisbon" visible onClose={jest.fn()} inviteMutation={inviteMutation} />
      </ThemeProvider>,
    );
    fireEvent.changeText(getByLabelText('Collaborator email address'), 'sam@example.com');
    fireEvent.press(getByRole('button', { name: 'Send invite' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const error = await findByText("You've sent a lot of invites today — try again tomorrow");
    expect(error.props.accessibilityRole).toBe('alert');
  });
});
