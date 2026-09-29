import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { ThemeProvider } from '@/theme';
import type { TripAccommodation } from '@/api/types';
import { AccommodationNotesEditor } from '../AccommodationNotesEditor';

const mockMutate = jest.fn((_vars: unknown, opts?: { onError?: () => void }) => opts?.onError?.());
jest.mock('@/api/trip-accommodations', () => ({
  useUpdateTripAccommodation: () => ({ mutate: mockMutate, isPending: false }),
}));

const acc = {
  id: 'a1',
  trip_id: 't1',
  name: 'Grand Hotel',
  google_place_id: null,
  address: null,
  lat: null,
  lng: null,
  check_in_date: null,
  check_out_date: null,
  notes: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
} as unknown as TripAccommodation;

describe('AccommodationNotesEditor', () => {
  it('keeps the draft and shows a retry when the save fails', () => {
    const { getByRole, getByLabelText, getByText } = render(
      <ThemeProvider>
        <AccommodationNotesEditor accommodation={acc} canEdit />
      </ThemeProvider>,
    );
    fireEvent.press(getByRole('button', { name: /Add note/ }));
    const input = getByLabelText(/Notes for accommodation/);
    fireEvent.changeText(input, 'late check-in code 4411');
    fireEvent(input, 'blur');
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(getByText('late check-in code 4411')).toBeTruthy();
    const retry = getByRole('button', { name: /notes\.saveFailed|save/i });
    fireEvent.press(retry);
    expect(mockMutate).toHaveBeenCalledTimes(2);
  });
});
