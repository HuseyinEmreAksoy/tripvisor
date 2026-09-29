/**
 * DraftReview edit-state snapshot (M5 F10 #1): a failed commit unmounts the
 * review; on remount with the same runId the user's edits must come back.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import type { AiDraft } from '@/api';
import { DraftReview } from '../DraftReview';
import type { DraftReviewSnapshot } from '../types';

jest.mock('@react-native-community/netinfo', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-community/netinfo/jest/netinfo-mock.js'),
);
jest.mock('@/lib/haptics', () => ({
  haptics: { tap: jest.fn(), impact: jest.fn(), select: jest.fn(), success: jest.fn(), error: jest.fn() },
}));

const draft: AiDraft = {
  places: [
    { name: 'Louvre', googlePlaceId: 'g1', lat: 48.86, lng: 2.33, visitMinutes: 120, category: 'museum', dayHint: 1 },
    { name: 'Orsay', googlePlaceId: 'g2', lat: 48.86, lng: 2.32, visitMinutes: 90, category: 'museum', dayHint: 2 },
  ],
  unresolved: [],
  notes: null,
  dayCount: 2,
};

function renderReview(props: Partial<Parameters<typeof DraftReview>[0]> = {}) {
  return render(
    <ThemeProvider>
      <DraftReview
        draft={draft}
        status="ok"
        defaultTitle="Paris · 2 days"
        onStartOver={() => {}}
        onCommit={() => {}}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe('DraftReview snapshot', () => {
  it('reports its edit state upward', () => {
    const onSnapshotChange = jest.fn();
    renderReview({ runId: 'run-1', onSnapshotChange });
    const last = onSnapshotChange.mock.calls.at(-1)?.[0] as DraftReviewSnapshot;
    expect(last.runId).toBe('run-1');
    expect(last.title).toBe('Paris · 2 days');
    expect(last.edits.map((e) => e.kept)).toEqual([true, true]);
  });

  it('re-seeds from a matching snapshot (title + removals survive a remount)', () => {
    const snapshot: DraftReviewSnapshot = {
      runId: 'run-1',
      title: 'My Paris trip',
      edits: [
        { localId: '0-g1', name: 'Louvre', googlePlaceId: 'g1', lat: 48.86, lng: 2.33, visitMinutes: 120, category: 'museum', dayHint: 1, kept: false },
        { localId: '1-g2', name: 'Orsay', googlePlaceId: 'g2', lat: 48.86, lng: 2.32, visitMinutes: 60, category: 'museum', dayHint: 1, kept: true },
      ],
    };
    const onSnapshotChange = jest.fn();
    const screen = renderReview({ runId: 'run-1', initialSnapshot: snapshot, onSnapshotChange });
    expect(screen.getByDisplayValue('My Paris trip')).toBeTruthy();
    const last = onSnapshotChange.mock.calls.at(-1)?.[0] as DraftReviewSnapshot;
    expect(last.edits).toEqual(snapshot.edits);
  });

  it('ignores a snapshot from a different run', () => {
    const screen = renderReview({
      runId: 'run-2',
      initialSnapshot: { runId: 'run-1', title: 'Stale', edits: [] },
    });
    expect(screen.getByDisplayValue('Paris · 2 days')).toBeTruthy();
  });
});
