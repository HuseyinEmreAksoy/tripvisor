import { describe, expect, it } from '@jest/globals';
import type { TripCollaborator } from '@/api/types';
import { groupCollaborators, inviteAge } from '../collaboratorModel';

function row(id: string, status: TripCollaborator['status']): TripCollaborator {
  return {
    id,
    trip_id: 't',
    invitee_email: `${id}@x.test`,
    user_id: null,
    role: 'viewer',
    status,
    created_at: '2026-09-20T10:00:00Z',
    accepted_at: null,
    revoked_at: null,
  } as TripCollaborator;
}

describe('groupCollaborators', () => {
  it('splits people / pending / past', () => {
    const g = groupCollaborators([
      row('b', 'accepted'),
      row('p', 'pending'),
      row('a', 'accepted'),
      row('d', 'declined'),
      row('r', 'revoked'),
    ]);
    expect(g.people.map((c) => c.id)).toEqual(['a', 'b']);
    expect(g.pending.map((c) => c.id)).toEqual(['p']);
    expect(g.past.map((c) => c.id).sort()).toEqual(['d', 'r']);
  });
});

describe('inviteAge', () => {
  const now = new Date('2026-09-22T10:00:00Z');

  it('describes a fresh invite', () => {
    expect(inviteAge('2026-09-22T09:00:00Z', now)).toEqual({
      expired: false,
      label: 'Sent today · expires in 7 days',
    });
  });

  it('counts down to expiry', () => {
    expect(inviteAge('2026-09-20T10:00:00Z', now).label).toBe('Sent 2 days ago · expires in 5 days');
  });

  it('flags invites past the 7-day TTL', () => {
    expect(inviteAge('2026-09-12T10:00:00Z', now)).toEqual({ expired: true, label: 'Expired 3 days ago' });
  });

  it('tolerates bad timestamps', () => {
    expect(inviteAge('nope', now)).toEqual({ expired: false, label: 'Invite sent' });
  });
});
