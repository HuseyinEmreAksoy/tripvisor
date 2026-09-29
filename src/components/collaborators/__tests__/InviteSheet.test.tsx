/**
 * InviteSheet — invite failure copy (2026-09-29 security follow-up, audit
 * #14 invite quotas). The manage-collaborators 429/503 codes get our own
 * copy (translated; the server's messages are English-only). Only problems
 * with the typed email redden the email field; quota and server failures
 * show as a form-level alert.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ThemeProvider, themes } from '@/theme';
import { i18n, setLanguagePreference } from '@/i18n';
import { InviteSheet, inviteError, type InviteErrorKey, type InviteSheetProps } from '../InviteSheet';

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

const collab = (key: InviteErrorKey) => i18n.t(`collab:${key}`);

afterEach(async () => {
  await act(async () => {
    await setLanguagePreference('system');
  });
});

describe('inviteError', () => {
  it.each([
    ['invite_rate_limited', 429, 'invite.errors.rateLimited', false],
    ['trip_invite_limit', 429, 'invite.errors.tripLimit', false],
    ['quota_unavailable', 503, 'invite.errors.unavailable', false],
    ['not_owner', 403, 'invite.errors.notOwner', false],
    ['already_invited', 409, 'invite.errors.alreadyInvited', true],
  ])('%s → our copy, not the English server message', (code, status, key, field) => {
    expect(inviteError(new MockCollaboratorError(code, 'server text', status))).toEqual({ key, field });
  });

  it('anything else gets the generic line (server messages are English-only)', () => {
    const generic = { key: 'invite.errors.generic', field: false };
    expect(inviteError(new MockCollaboratorError('db_error', 'Database hiccup', 500))).toEqual(generic);
    expect(inviteError(new Error('Network request failed'))).toEqual(generic);
    expect(inviteError('boom')).toEqual(generic);
  });
});

describe('InviteSheet', () => {
  function renderSheet(mutateAsync: () => Promise<unknown>) {
    const inviteMutation = { mutateAsync, isPending: false } as unknown as InviteSheetProps['inviteMutation'];
    return render(
      <ThemeProvider>
        <InviteSheet tripId="trip-1" tripTitle="Lisbon" visible onClose={jest.fn()} inviteMutation={inviteMutation} />
      </ThemeProvider>,
    );
  }

  const borderOf = (input: { props: { style: unknown } }) =>
    (StyleSheet.flatten(input.props.style as never) as { borderColor?: string }).borderColor;
  const DANGER = [themes.light.danger, themes.dark.danger];

  async function invite(utils: ReturnType<typeof renderSheet>, email: string) {
    fireEvent.changeText(utils.getByLabelText('Collaborator email address'), email);
    // The handler awaits the mutation, so settle it inside act.
    await act(async () => {
      fireEvent.press(utils.getByRole('button', { name: 'Send invite' }));
    });
  }

  it('shows the rate-limit copy as a form alert without reddening the email field', async () => {
    const mutateAsync = jest.fn(() =>
      Promise.reject(new MockCollaboratorError('invite_rate_limited', 'Daily invite limit reached', 429)),
    );
    const utils = renderSheet(mutateAsync);
    const input = utils.getByLabelText('Collaborator email address');
    const idleBorder = borderOf(input);
    await invite(utils, 'sam@example.com');
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    const error = await utils.findByText(collab('invite.errors.rateLimited'));
    expect(error.props.accessibilityRole).toBe('alert');
    expect(borderOf(utils.getByLabelText('Collaborator email address'))).toBe(idleBorder);
    expect(DANGER).not.toContain(idleBorder);
  });

  it('reddens the email field when the email itself is the problem', async () => {
    const mutateAsync = jest.fn(() =>
      Promise.reject(new MockCollaboratorError('already_invited', 'Already invited', 409)),
    );
    const utils = renderSheet(mutateAsync);
    await invite(utils, 'sam@example.com');
    expect(await utils.findByText(collab('invite.errors.alreadyInvited'))).toBeTruthy();
    expect(DANGER).toContain(borderOf(utils.getByLabelText('Collaborator email address')));
  });

  it('validates the email locally, in the app language', async () => {
    const mutateAsync = jest.fn(() => Promise.resolve({}));
    const utils = renderSheet(mutateAsync);
    await act(async () => {
      await setLanguagePreference('tr');
    });
    await invite(utils, 'not-an-email');
    expect(utils.getByText('Geçerli bir e-posta adresi gir.').props.accessibilityRole).toBe('alert');
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(DANGER).toContain(borderOf(utils.getByLabelText('Collaborator email address')));
  });
});
