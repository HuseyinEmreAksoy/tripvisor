/**
 * MemoryDaySection + JournalEditor (M5 Y3.1): the day journal is created
 * PRIVATE unless the switch is on; the day's bulk share targets own items
 * only; a failed upload tile offers Retry / Cancel; the owner can remove a
 * trip-mate's shared entry.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { ThemeProvider } from '@/theme';
import { i18n } from '@/i18n';
import type { MemoryItem, MemoryPhotoItem } from '@/api/memories.types';

const mockSave = jest.fn(async (_input: unknown) => 'j-new');
const mockSetVisibility = jest.fn();
let mockEntry: { id: string; body: string; visibility: 'only_me' | 'trip' } | null = null;

jest.mock('@/api/memories', () => ({
  useJournalEntry: () => ({ data: mockEntry, entries: mockEntry ? [mockEntry] : [], isLoading: false }),
  useSaveJournalEntry: () => ({ mutateAsync: mockSave, isPending: false }),
  useSetMemoryVisibility: () => ({ mutate: mockSetVisibility }),
  useDeleteMemory: () => ({ mutate: jest.fn() }),
}));
jest.mock('@/lib/confirm', () => ({ confirmDestructive: async () => true }));
jest.mock('@/lib/haptics', () => ({ haptics: { tap: jest.fn() } }));

// eslint-disable-next-line import/first
import { MemoryDaySection } from '../MemoryDaySection';

// Untyped view of i18n.t: test keys are built at runtime.
const translate = i18n.t as unknown as (key: string, opts?: Record<string, unknown>) => string;
const tx = (key: string, opts?: Record<string, unknown>) => translate(`memories:${key}`, opts);

function wrap(node: ReactElement) {
  return render(<ThemeProvider>{node}</ThemeProvider>);
}

const failedPhoto: MemoryPhotoItem = {
  kind: 'photo',
  id: 'p1',
  tripId: 'trip-1',
  dayIndex: 1,
  at: '2026-10-02T10:00:00Z',
  isOwn: true,
  visibility: 'only_me',
  photo: null,
  upload: {
    id: 'p1',
    tripId: 'trip-1',
    dayIndex: 1,
    tripPlaceId: null,
    caption: null,
    visibility: 'only_me',
    takenAt: null,
    width: 100,
    height: 100,
    bytes: 1000,
    state: 'failed',
    progress: 0.15,
    waitingFor: null,
    error: { code: 'quota_exceeded', scope: 'user' },
    previewUri: null,
    createdAt: 1,
  },
};

const sharedByMate: MemoryItem = {
  kind: 'journal',
  id: 'j-mate',
  tripId: 'trip-1',
  dayIndex: 1,
  at: '2026-10-02T12:00:00Z',
  isOwn: false,
  visibility: 'trip',
  entry: { body: 'Sunset at the castle' } as never,
};

const handlers = {
  onOpenPhoto: jest.fn(),
  onRetryUpload: jest.fn(),
  onCancelUpload: jest.fn(),
  onAddPhotos: jest.fn(),
  onSetVisibility: jest.fn(),
  onRemove: jest.fn(),
  onOpenReview: jest.fn(),
};

function renderDay(items: MemoryItem[], props: { canWrite?: boolean; isOwner?: boolean } = {}) {
  return wrap(
    <MemoryDaySection
      tripId="trip-1"
      group={{ dayIndex: 1, items }}
      dateLabel="Fri 2 Oct"
      thumbUrls={{}}
      tileSize={96}
      canWrite={props.canWrite ?? true}
      isOwner={props.isOwner ?? false}
      placeName={() => null}
      addBusy={false}
      {...handlers}
    />,
  );
}

beforeEach(() => {
  mockEntry = null;
  mockSave.mockClear();
  mockSetVisibility.mockClear();
  Object.values(handlers).forEach((h) => h.mockClear());
});

describe('MemoryDaySection', () => {
  it('creates the day journal PRIVATE by default', async () => {
    const { getByLabelText } = renderDay([]);
    fireEvent.changeText(getByLabelText(tx('journal.label', { day: 2 })), 'Long walk by the river');
    await act(async () => {
      fireEvent.press(getByLabelText(tx('actions.save')));
    });
    expect(mockSave).toHaveBeenCalledWith({
      tripId: 'trip-1',
      dayIndex: 1,
      body: 'Long walk by the river',
      visibility: 'only_me',
    });
  });

  it('creates it SHARED when "Share with trip" is on before saving', async () => {
    const { getByLabelText } = renderDay([]);
    fireEvent(getByLabelText(tx('visibility.a11y', { item: tx('items.journal') })), 'valueChange', true);
    fireEvent.changeText(getByLabelText(tx('journal.label', { day: 2 })), 'Dinner by the sea');
    await act(async () => {
      fireEvent.press(getByLabelText(tx('actions.save')));
    });
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ visibility: 'trip' }));
  });

  it('flips an existing entry right away', () => {
    mockEntry = { id: 'j1', body: 'Hello', visibility: 'only_me' };
    const { getByLabelText } = renderDay([]);
    fireEvent(getByLabelText(tx('visibility.a11y', { item: tx('items.journal') })), 'valueChange', true);
    expect(mockSetVisibility).toHaveBeenCalledWith(
      { tripId: 'trip-1', items: [{ kind: 'journal', id: 'j1' }], visibility: 'trip' },
      expect.anything(),
    );
  });

  it('bulk-shares the day and handles a failed upload tile', () => {
    const { getByLabelText, getByText } = renderDay([failedPhoto]);
    const day = tx('dayLabel', { day: 2 });
    fireEvent.press(getByLabelText(tx('actions.shareDayA11y', { day })));
    expect(handlers.onSetVisibility).toHaveBeenCalledWith([failedPhoto], 'trip');
    expect(getByText(tx('errors.quota_user'))).toBeTruthy();
    fireEvent.press(getByLabelText(tx('actions.retry')));
    expect(handlers.onRetryUpload).toHaveBeenCalledWith('p1');
    fireEvent.press(getByLabelText(tx('actions.cancelUpload')));
    expect(handlers.onCancelUpload).toHaveBeenCalledWith('p1');
  });

  it("shows a trip-mate's shared entry; only the owner can remove it", () => {
    const viewer = renderDay([sharedByMate], { isOwner: false });
    expect(viewer.getByText('Sunset at the castle')).toBeTruthy();
    expect(viewer.queryByLabelText(tx('actions.removeFromTrip'))).toBeNull();
    viewer.unmount();
    const owner = renderDay([sharedByMate], { isOwner: true });
    fireEvent.press(owner.getByLabelText(tx('actions.removeFromTrip')));
    expect(handlers.onRemove).toHaveBeenCalledWith(sharedByMate);
  });

  it('hides add + journal for a user who left the trip', () => {
    const { queryByLabelText } = renderDay([], { canWrite: false });
    expect(queryByLabelText(tx('journal.label', { day: 2 }))).toBeNull();
    expect(queryByLabelText(tx('actions.addPhotosToDay', { day: 2 }))).toBeNull();
  });
});
