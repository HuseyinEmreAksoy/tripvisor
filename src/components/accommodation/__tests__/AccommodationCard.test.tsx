/**
 * AccommodationCard — rendering tests.
 *
 * Covers:
 *   1. Date-range formatting: check_in → check_out appears correctly.
 *   2. Day-bridge label: "Day X → Day Y" computed from tripStartDate.
 *   3. Address rendering: free-text address shown as caption text.
 *   4. google_place_id rendering: "Google Place" chip when no address.
 *   5. Edit + Delete buttons visible when canEdit=true; hidden when false.
 *   6. Notes rendering when notes is non-null.
 *
 * Phase 25 Step 25.10 added AccommodationNotesEditor, an inline sub-component
 * that unconditionally calls useUpdateTripAccommodation() (which requires a
 * QueryClientProvider). We mock that module at the boundary and wrap renders
 * with a fresh QueryClientProvider so the hook context is always satisfied.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { AccommodationCard } from '../AccommodationCard';
import { ThemeProvider } from '@/theme';
import type { TripAccommodation } from '@/api/types';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---- Module mock: trip-accommodations ----------------------------------------
// useUpdateTripAccommodation is called unconditionally by AccommodationNotesEditor;
// mock it with a no-op mutate so tests don't need a real Supabase client.
jest.mock('@/api/trip-accommodations', () => ({
  useUpdateTripAccommodation: () => ({
    mutate: jest.fn(),
    isPending: false,
  }),
}));

jest.mock('@/lib/clipboard', () => ({ copyToClipboard: jest.fn(async () => true) }));
jest.mock('@/lib/haptics', () => ({
  haptics: { tap: jest.fn(), select: jest.fn(), success: jest.fn(), impact: jest.fn(), warning: jest.fn(), error: jest.fn() },
}));

// ---- Helpers -----------------------------------------------------------------

function makeAccommodation(
  overrides: Partial<TripAccommodation> = {},
): TripAccommodation {
  return {
    id: 'accom-1',
    trip_id: 'trip-1',
    name: 'Grand Hotel',
    google_place_id: null,
    address: '42 Main Street, Rome',
    lat: null,
    lng: null,
    check_in_date: '2026-05-10',
    check_out_date: '2026-05-13',
    notes: null,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrap(node: React.ReactElement) {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <ThemeProvider>{node}</ThemeProvider>
    </QueryClientProvider>,
  );
}

// ---- Tests -------------------------------------------------------------------

describe('AccommodationCard', () => {
  it('renders the accommodation name', () => {
    const { getByText } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation()}
        tripStartDate={null}
        canEdit={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(getByText('Grand Hotel')).toBeTruthy();
  });

  it('shows formatted check-in / check-out dates and the night count (X2.4)', () => {
    const { getByText } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation({
          check_in_date: '2026-05-10',
          check_out_date: '2026-05-13',
        })}
        tripStartDate={null}
        canEdit={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(getByText('Sun 10 May')).toBeTruthy();
    expect(getByText('Wed 13 May')).toBeTruthy();
    expect(getByText('3 nights')).toBeTruthy();
  });

  it('renders a day-bridge label when tripStartDate is provided', () => {
    // Trip starts 2026-05-08 (day 1).
    // Check-in  2026-05-10 → day 3.
    // Check-out 2026-05-13 → day 6.
    // Expected pill: "Day 3 → Day 6".
    const { getByText } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation({
          check_in_date: '2026-05-10',
          check_out_date: '2026-05-13',
        })}
        tripStartDate="2026-05-08"
        canEdit={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(getByText('Day 3 → Day 6')).toBeTruthy();
  });

  it('renders "Day N" (single day) when check-in equals check-out day relative to trip start', () => {
    // Trip starts 2026-06-01 (day 1).
    // Check-in = check-out = 2026-06-01 → inDay=1, outDay=1 → "Day 1".
    const { getByText } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation({
          check_in_date: '2026-06-01',
          check_out_date: '2026-06-01',
        })}
        tripStartDate="2026-06-01"
        canEdit={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(getByText('Day 1')).toBeTruthy();
  });

  it('renders the address as text when google_place_id is null', () => {
    const { getByText } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation({
          address: '42 Main Street, Rome',
          google_place_id: null,
        })}
        tripStartDate={null}
        canEdit={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(getByText('42 Main Street, Rome')).toBeTruthy();
  });

  it('renders "Google Place" chip when google_place_id is set and address is null', () => {
    const { getByText } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation({
          google_place_id: 'ChIJplace123',
          address: null,
        })}
        tripStartDate={null}
        canEdit={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(getByText('Google Place')).toBeTruthy();
  });

  it('renders notes when provided', () => {
    const { getByText } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation({ notes: 'Breakfast included' })}
        tripStartDate={null}
        canEdit={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(getByText('Breakfast included')).toBeTruthy();
  });

  it('shows Edit and Delete buttons when canEdit=true', () => {
    const { getByRole } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation()}
        tripStartDate={null}
        canEdit
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(getByRole('button', { name: /edit accommodation: grand hotel/i })).toBeTruthy();
    expect(getByRole('button', { name: /delete accommodation: grand hotel/i })).toBeTruthy();
  });

  it('hides Edit and Delete buttons when canEdit=false', () => {
    const { queryByRole } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation()}
        tripStartDate={null}
        canEdit={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(queryByRole('button', { name: /edit accommodation/i })).toBeNull();
    expect(queryByRole('button', { name: /delete accommodation/i })).toBeNull();
  });

  it('fires onEdit callback when Edit button is pressed', () => {
    const onEdit = jest.fn();
    const { getByRole } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation()}
        tripStartDate={null}
        canEdit
        onEdit={onEdit}
        onDelete={jest.fn()}
      />,
    );
    fireEvent.press(getByRole('button', { name: /edit accommodation/i }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it('has an accessible label combining name and date range', () => {
    const { getByLabelText } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation()}
        tripStartDate={null}
        canEdit={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(
      getByLabelText('Grand Hotel, check-in Sun 10 May, check-out Wed 13 May, 3 nights'),
    ).toBeTruthy();
  });

  it('opens directions to the stay coordinates when Navigate is pressed (X2.4)', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { getByRole } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation({ lat: 41.9, lng: 12.5, google_place_id: 'ChIJx' })}
        tripStartDate={null}
        canEdit={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    fireEvent.press(getByRole('button', { name: /navigate to grand hotel/i }));
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(String(openURL.mock.calls[0]?.[0])).toMatch(/41\.9(%2C|,)12\.5/);
    openURL.mockRestore();
  });

  it('falls back to the address when the stay has no coordinates (X2.4)', () => {
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { getByRole } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation()}
        tripStartDate={null}
        canEdit={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    fireEvent.press(getByRole('button', { name: /navigate to grand hotel/i }));
    expect(String(openURL.mock.calls[0]?.[0])).toContain(encodeURIComponent('42 Main Street, Rome'));
    openURL.mockRestore();
  });

  it('hides Navigate when there is neither an address nor coordinates', () => {
    const { queryByRole } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation({ address: null })}
        tripStartDate={null}
        canEdit={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(queryByRole('button', { name: /navigate/i })).toBeNull();
  });

  it('shows a copyable confirmation code parsed from notes and hides that line from the notes (X2.4)', async () => {
    const { copyToClipboard } = jest.requireMock('@/lib/clipboard') as { copyToClipboard: jest.Mock };
    const { getByRole, getByText, queryByText } = wrap(
      <AccommodationCard
        accommodation={makeAccommodation({ notes: 'Confirmation: HX7Q29\nLate check-in OK' })}
        tripStartDate={null}
        canEdit={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
      />,
    );
    expect(getByText('HX7Q29')).toBeTruthy();
    expect(getByText('Late check-in OK')).toBeTruthy();
    expect(queryByText(/Confirmation: HX7Q29/)).toBeNull();
    fireEvent.press(getByRole('button', { name: /copy confirmation code hx7q29/i }));
    await waitFor(() => expect(getByText('Copied ✓')).toBeTruthy());
    expect(copyToClipboard).toHaveBeenCalledWith('HX7Q29');
  });
});
