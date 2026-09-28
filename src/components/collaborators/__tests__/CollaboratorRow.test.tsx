import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import type { TripCollaborator } from '@/api/types';
import { CollaboratorRow } from '../CollaboratorRow';

const NOW = new Date('2026-09-22T10:00:00Z');

function row(status: TripCollaborator['status'], role: TripCollaborator['role'] = 'viewer'): TripCollaborator {
  return {
    id: 'c1',
    trip_id: 't',
    invitee_email: 'sam@x.test',
    user_id: null,
    role,
    status,
    created_at: '2026-09-20T10:00:00Z',
    accepted_at: null,
    revoked_at: null,
  } as TripCollaborator;
}

function wrap(node: React.ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

describe('CollaboratorRow', () => {
  it('owner sees role chips for an accepted collaborator and can switch role', () => {
    const onRoleChange = jest.fn();
    const { getByRole } = wrap(
      <CollaboratorRow collab={row('accepted')} canManage onRevoke={() => {}} onRoleChange={onRoleChange} now={NOW} />,
    );
    expect(getByRole('radio', { name: /^Viewer/ }).props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(getByRole('radio', { name: /^Editor/ }));
    expect(onRoleChange).toHaveBeenCalledWith('editor');
  });

  it('pressing the already-selected role is a no-op', () => {
    const onRoleChange = jest.fn();
    const { getByRole } = wrap(
      <CollaboratorRow collab={row('accepted')} canManage onRevoke={() => {}} onRoleChange={onRoleChange} now={NOW} />,
    );
    fireEvent.press(getByRole('radio', { name: /^Viewer/ }));
    expect(onRoleChange).not.toHaveBeenCalled();
  });

  it('owner can remove an accepted collaborator', () => {
    const onRevoke = jest.fn();
    const { getByRole } = wrap(
      <CollaboratorRow collab={row('accepted')} canManage onRevoke={onRevoke} onRoleChange={() => {}} now={NOW} />,
    );
    fireEvent.press(getByRole('button', { name: /remove sam@x\.test from this trip/i }));
    expect(onRevoke).toHaveBeenCalledTimes(1);
  });

  it('pending invite shows expiry and a Cancel action, no role chips', () => {
    const onRevoke = jest.fn();
    const { getByRole, getByText, queryByRole } = wrap(
      <CollaboratorRow collab={row('pending')} canManage onRevoke={onRevoke} onRoleChange={() => {}} now={NOW} />,
    );
    expect(getByText('Sent 2 days ago · expires in 5 days')).toBeTruthy();
    expect(queryByRole('radio')).toBeNull();
    fireEvent.press(getByRole('button', { name: /cancel the invite for sam@x\.test/i }));
    expect(onRevoke).toHaveBeenCalledTimes(1);
  });

  it('non-owners get a read-only row', () => {
    const { queryByRole } = wrap(<CollaboratorRow collab={row('accepted', 'editor')} canManage={false} now={NOW} />);
    expect(queryByRole('button')).toBeNull();
    expect(queryByRole('radio')).toBeNull();
  });
});
