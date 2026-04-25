/**
 * useTripRole — unit tests.
 *
 * Three scenarios:
 *   1. Owner: trip.user_id === session.user.id  → role='owner', canEditTrip=true, isOwner=true
 *   2. Accepted viewer collaborator              → role='viewer', canEditTrip=false
 *   3. Non-collaborator (no matching row)        → role=null, canEditTrip=false
 *
 * All three external hooks (useSession, useTrip, useTripCollaborators) are
 * mocked at the module boundary. Tests use renderHook + act from
 * @testing-library/react-native. A QueryClientProvider wraps each render to
 * prevent cross-test cache leaks (even though the mocked hooks bypass the cache,
 * the provider keeps the environment clean).
 */
import { renderHook } from '@testing-library/react-native';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useTripRole } from '../useTripRole';

// ---- Mock types ---------------------------------------------------------------

interface MockSession {
  user: { id: string; email: string } | null;
}

interface MockTrip {
  id: string;
  user_id: string;
}

interface MockCollaborator {
  id: string;
  trip_id: string;
  user_id: string | null;
  status: string;
  role: string;
}

// ---- Module-level mock state --------------------------------------------------
// Variables used in jest.mock factories must be declared in module scope.

let mockSessionData: MockSession | undefined = undefined;
let mockSessionLoading = false;
let mockTripData: MockTrip | undefined = undefined;
let mockTripLoading = false;
let mockCollaborators: MockCollaborator[] = [];
let mockCollabLoading = false;

// ---- Module mocks -------------------------------------------------------------

jest.mock('@/api/auth', () => ({
  useSession: () => ({
    data: mockSessionData,
    isLoading: mockSessionLoading,
  }),
}));

jest.mock('@/api/trips', () => ({
  useTrip: (_id: string | undefined) => ({
    data: mockTripData,
    isLoading: mockTripLoading,
  }),
}));

jest.mock('@/api/trip-collaborators', () => ({
  useTripCollaborators: (_tripId: string | undefined) => ({
    data: mockCollaborators,
    isLoading: mockCollabLoading,
  }),
}));

// ---- Helpers -----------------------------------------------------------------

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: () => {}, warn: () => {}, error: () => {} } as typeof console,
  });
}

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = makeQueryClient();
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

function resetMocks() {
  mockSessionData = undefined;
  mockSessionLoading = false;
  mockTripData = undefined;
  mockTripLoading = false;
  mockCollaborators = [];
  mockCollabLoading = false;
}

// ---- Tests -------------------------------------------------------------------

const TRIP_ID = 'trip-aaaa-1111';
const OWNER_UID = 'user-owner-111';
const VIEWER_UID = 'user-viewer-222';

beforeEach(resetMocks);

describe('useTripRole', () => {
  it('returns role="owner" and canEditTrip=true when current user owns the trip', () => {
    mockSessionData = { user: { id: OWNER_UID, email: 'owner@test.local' } };
    mockTripData = { id: TRIP_ID, user_id: OWNER_UID };

    const { result } = renderHook(() => useTripRole(TRIP_ID), { wrapper });

    expect(result.current.role).toBe('owner');
    expect(result.current.canEditTrip).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns role="viewer" and canEditTrip=false for an accepted viewer collaborator', () => {
    mockSessionData = { user: { id: VIEWER_UID, email: 'viewer@test.local' } };
    // Trip is owned by someone else — this user is NOT the owner.
    mockTripData = { id: TRIP_ID, user_id: OWNER_UID };
    // Collaborator row: accepted viewer for VIEWER_UID.
    mockCollaborators = [
      {
        id: 'collab-row-1',
        trip_id: TRIP_ID,
        user_id: VIEWER_UID,
        status: 'accepted',
        role: 'viewer',
      },
    ];

    const { result } = renderHook(() => useTripRole(TRIP_ID), { wrapper });

    expect(result.current.role).toBe('viewer');
    expect(result.current.canEditTrip).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns role=null and canEditTrip=false when user has no relationship to the trip', () => {
    const STRANGER_UID = 'user-stranger-333';
    mockSessionData = { user: { id: STRANGER_UID, email: 'stranger@test.local' } };
    mockTripData = { id: TRIP_ID, user_id: OWNER_UID };
    // Collaborators list is empty (no row for this user).
    mockCollaborators = [];

    const { result } = renderHook(() => useTripRole(TRIP_ID), { wrapper });

    expect(result.current.role).toBeNull();
    expect(result.current.canEditTrip).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it('returns role="editor" and canEditTrip=true for an accepted editor collaborator', () => {
    const EDITOR_UID = 'user-editor-444';
    mockSessionData = { user: { id: EDITOR_UID, email: 'editor@test.local' } };
    mockTripData = { id: TRIP_ID, user_id: OWNER_UID };
    mockCollaborators = [
      {
        id: 'collab-row-2',
        trip_id: TRIP_ID,
        user_id: EDITOR_UID,
        status: 'accepted',
        role: 'editor',
      },
    ];

    const { result } = renderHook(() => useTripRole(TRIP_ID), { wrapper });

    expect(result.current.role).toBe('editor');
    expect(result.current.canEditTrip).toBe(true);
  });

  it('returns role=null while session is loading', () => {
    mockSessionLoading = true;
    // Session data and trip data are undefined during loading.
    mockSessionData = undefined;
    mockTripData = undefined;

    const { result } = renderHook(() => useTripRole(TRIP_ID), { wrapper });

    expect(result.current.role).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });

  it('returns role=null for a pending collaborator (not yet accepted)', () => {
    const PENDING_UID = 'user-pending-555';
    mockSessionData = { user: { id: PENDING_UID, email: 'pending@test.local' } };
    mockTripData = { id: TRIP_ID, user_id: OWNER_UID };
    mockCollaborators = [
      {
        id: 'collab-row-pending',
        trip_id: TRIP_ID,
        user_id: PENDING_UID,
        status: 'pending',
        role: 'viewer',
      },
    ];

    const { result } = renderHook(() => useTripRole(TRIP_ID), { wrapper });

    // The hook checks status === 'accepted'; a pending row does not grant a role.
    expect(result.current.role).toBeNull();
    expect(result.current.canEditTrip).toBe(false);
  });
});
