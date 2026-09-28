/**
 * collaboratorModel.ts — pure helpers for the collaborators screen.
 * No React / platform code, so they are trivially unit-testable.
 */
import type { TripCollaborator } from '@/api/types';

/** Mirrors the 7-day pending-invite TTL enforced by `manage-collaborators`. */
export const INVITE_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CollaboratorGroups {
  /** Accepted collaborators — have access right now. */
  people: TripCollaborator[];
  /** Invites that were sent but not yet accepted or declined. */
  pending: TripCollaborator[];
  /** Declined and revoked rows (read-only history). */
  past: TripCollaborator[];
}

export function groupCollaborators(rows: readonly TripCollaborator[]): CollaboratorGroups {
  const byEmail = (a: TripCollaborator, b: TripCollaborator) =>
    a.invitee_email.localeCompare(b.invitee_email);
  const newestFirst = (a: TripCollaborator, b: TripCollaborator) =>
    (b.created_at ?? '').localeCompare(a.created_at ?? '');
  return {
    people: rows.filter((r) => r.status === 'accepted').sort(byEmail),
    pending: rows.filter((r) => r.status === 'pending').sort(newestFirst),
    past: rows.filter((r) => r.status === 'declined' || r.status === 'revoked').sort(newestFirst),
  };
}

export interface InviteAge {
  expired: boolean;
  /** e.g. "Sent today · expires in 7 days" / "Expired 2 days ago". */
  label: string;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function inviteAge(createdAt: string | null | undefined, now: Date = new Date()): InviteAge {
  const created = createdAt ? Date.parse(createdAt) : NaN;
  if (Number.isNaN(created)) return { expired: false, label: 'Invite sent' };
  const ageDays = Math.max(0, Math.floor((now.getTime() - created) / DAY_MS));
  const expiresAt = created + INVITE_TTL_DAYS * DAY_MS;
  const msLeft = expiresAt - now.getTime();
  const sent = ageDays === 0 ? 'Sent today' : `Sent ${plural(ageDays, 'day')} ago`;
  if (msLeft <= 0) {
    const overdue = Math.floor(-msLeft / DAY_MS);
    return {
      expired: true,
      label: overdue === 0 ? 'Expired today' : `Expired ${plural(overdue, 'day')} ago`,
    };
  }
  const daysLeft = Math.ceil(msLeft / DAY_MS);
  return {
    expired: false,
    label: `${sent} · expires in ${daysLeft <= 1 ? 'under a day' : plural(daysLeft, 'day')}`,
  };
}

/** Friendly copy for each status, used in chips and a11y labels. */
export const STATUS_LABEL: Record<TripCollaborator['status'], string> = {
  pending: 'Pending',
  accepted: 'Active',
  declined: 'Declined',
  revoked: 'Revoked',
};

export const ROLE_COPY: Record<TripCollaborator['role'], { label: string; hint: string }> = {
  viewer: { label: 'Viewer', hint: 'Can see the itinerary, map and expenses' },
  editor: { label: 'Editor', hint: 'Can add and edit places, notes and expenses' },
};
