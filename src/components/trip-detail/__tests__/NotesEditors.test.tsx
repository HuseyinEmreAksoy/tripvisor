/**
 * NotesEditors (F3 fix): the server echo of our own trimmed save must not
 * overwrite what the user is still typing; external changes still reseed
 * the editor once it is closed.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import type { TripDay, TripPlace } from '@/api';

const mockMutate = jest.fn();

jest.mock('@/api', () => ({
  useUpdateTripDay: () => ({ mutate: mockMutate }),
  useUpdateTripPlace: () => ({ mutate: mockMutate }),
}));

// eslint-disable-next-line import/first
import { DayNotesEditor, PlaceNotesEditor } from '../NotesEditors';

function makePlace(notes: string | null): TripPlace {
  return { id: 'p1', trip_id: 't1', user_title: 'Louvre', notes } as unknown as TripPlace;
}

describe('PlaceNotesEditor', () => {
  it('keeps in-progress text when the prop echoes the trimmed save', () => {
    const { getByLabelText, rerender } = render(
      <ThemeProvider>
        <PlaceNotesEditor place={makePlace(null)} />
      </ThemeProvider>,
    );
    fireEvent.press(getByLabelText('Add notes for Louvre'));
    const input = getByLabelText('Notes for Louvre');
    fireEvent.changeText(input, 'Buy tickets ');
    rerender(
      <ThemeProvider>
        <PlaceNotesEditor place={makePlace('Buy tickets')} />
      </ThemeProvider>,
    );
    expect(getByLabelText('Notes for Louvre').props.value).toBe('Buy tickets ');
  });

  it('reseeds from the prop when not editing', () => {
    const { getByText, rerender } = render(
      <ThemeProvider>
        <PlaceNotesEditor place={makePlace('Old')} />
      </ThemeProvider>,
    );
    rerender(
      <ThemeProvider>
        <PlaceNotesEditor place={makePlace('New from another device')} />
      </ThemeProvider>,
    );
    expect(getByText('New from another device')).toBeTruthy();
  });
});

describe('DayNotesEditor', () => {
  it('keeps in-progress text while expanded', () => {
    const day = (notes: string | null) => ({ notes } as unknown as TripDay);
    const { getByLabelText, rerender } = render(
      <ThemeProvider>
        <DayNotesEditor tripId="t1" dayIndex={0} dayRecord={day(null)} />
      </ThemeProvider>,
    );
    fireEvent.press(getByLabelText('Add notes for Day 1'));
    fireEvent.changeText(getByLabelText('Notes for Day 1'), 'Line one\n');
    act(() => {
      rerender(
        <ThemeProvider>
          <DayNotesEditor tripId="t1" dayIndex={0} dayRecord={day('Line one')} />
        </ThemeProvider>,
      );
    });
    expect(getByLabelText('Notes for Day 1').props.value).toBe('Line one\n');
  });
});
