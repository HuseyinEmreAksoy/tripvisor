/**
 * Public share page (app/share/[token].tsx) — M5 Y3.5 sections.
 *
 * Each optional section renders only when its key is in the payload, the
 * itinerary shows "hidden by the owner" when turned off, a rate-limited read
 * gets the "try again later" state, estimated legs get "≈", and the memories
 * lightbox loads the FULL image through `useSharedPhotoUrl(token, photo.id)`.
 *
 * Lives outside app/ so Expo Router never picks the test up as a route.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme';
import { formatMoney, i18n, setLanguagePreference } from '@/i18n';
import type { SharedTripPayload } from '@/api/share';
import SharedTripView from '../../../../app/share/[token]';

const TOKEN = 'tok_1234567890abcdef';

let mockQuery: { data?: SharedTripPayload | null; isLoading?: boolean; isError?: boolean; error?: Error | null } = {};
const mockPhotoUrlCalls: Array<[string | undefined, string | undefined]> = [];
let mockPhotoUrl: { data?: { url: string }; isLoading?: boolean; isError?: boolean; error?: Error | null } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ token: 'tok_1234567890abcdef' }),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/hooks/useBreakpoint', () => ({ useBreakpoint: () => 'mobile' }));
jest.mock('@/components/Map', () => ({
  Map: () => null,
  decodePolyline: () => [],
}));
jest.mock('@/components/share/SharedTripHead', () => ({ SharedTripHead: () => null }));
jest.mock('@/components/share/shareSheet', () => ({
  shareLink: jest.fn(),
  buildAppUrl: (path: string) => ({ url: `https://tripvisor.test/${path}`, usingDeepLink: false }),
}));
jest.mock('@/api/share', () => {
  class ShareLinkError extends Error {
    code: string;
    status: number;
    constructor(code: string, message: string, status: number) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    ShareLinkError,
    useSharedTrip: () => ({ refetch: jest.fn(), isLoading: false, isError: false, error: null, ...mockQuery }),
    useSharedPhotoUrl: (token: string | undefined, photoId: string | undefined) => {
      mockPhotoUrlCalls.push([token, photoId]);
      return { isLoading: false, isError: false, error: null, ...mockPhotoUrl };
    },
  };
});

const { ShareLinkError: MockShareLinkError } = jest.requireMock<{
  ShareLinkError: new (code: string, message: string, status: number) => Error;
}>('@/api/share');

function payload(overrides: Partial<SharedTripPayload> = {}): SharedTripPayload {
  return {
    trip: {
      title: 'Lisbon long weekend',
      start_date: '2026-11-02',
      end_date: '2026-11-04',
      daily_hours_budget: 8,
      transport_mode: 'walking',
      timezone: 'Europe/Lisbon',
    },
    places: [
      { id: 'p1', google_place_id: 'g1', user_title: 'Belém Tower', category: 'attraction', lat: 1, lng: 1, visit_duration_minutes: 60, day_index: 0, order_in_day: 0 },
      { id: 'p2', google_place_id: 'g2', user_title: 'Jerónimos', category: 'museum', lat: 1, lng: 1, visit_duration_minutes: 90, day_index: 0, order_in_day: 1 },
    ],
    legs: [
      {
        id: 'l1',
        from_place_id: 'p1',
        to_place_id: 'p2',
        day_index: 0,
        transport_mode: 'transit',
        duration_seconds: 720,
        distance_meters: 3400,
        polyline: null,
        computed_at: '2026-10-01T00:00:00Z',
        source: 'estimate',
      } as SharedTripPayload['legs'][number],
    ],
    sections: { itinerary: true, expenses: false, memories: false },
    ...overrides,
  } as SharedTripPayload;
}

const MEMORIES: NonNullable<SharedTripPayload['memories']> = {
  journal: [{ id: 'j1', dayIndex: 0, body: 'We got lost in Alfama and loved it.', createdAt: '2026-11-02T20:00:00Z' }],
  reviews: [{ id: 'r1', placeId: 'p1', placeName: 'Pastéis de Belém', rating: 4, body: 'Worth the queue.', createdAt: '2026-11-02T12:00:00Z' }],
  photos: [
    { id: 'ph1', dayIndex: 0, placeId: null, caption: 'Sunset', takenAt: '2026-11-02T18:00:00Z', width: 400, height: 300, thumbUrl: 'https://x/thumb1.jpg', url: 'https://x/thumb1.jpg' },
    { id: 'ph2', dayIndex: 1, placeId: null, caption: null, takenAt: '2026-11-03T10:00:00Z', width: 400, height: 300, thumbUrl: 'https://x/thumb2.jpg', url: 'https://x/thumb2.jpg' },
  ],
  photoUrlExpiresAt: '2026-11-05T00:00:00Z',
  truncated: false,
};

function renderPage() {
  const utils = render(
    <ThemeProvider>
      <SharedTripView />
    </ThemeProvider>,
  );
  // The photo grid sizes its tiles from the measured width.
  const grid = utils.UNSAFE_root.findAll(
    (n: { props: Record<string, unknown> }) => typeof n.props?.onLayout === 'function' && n.props?.style && JSON.stringify(n.props.style).includes('wrap'),
  );
  for (const g of grid) {
    const onLayout = g.props.onLayout as (e: { nativeEvent: { layout: { width: number; height: number; x: number; y: number } } }) => void;
    act(() => onLayout({ nativeEvent: { layout: { width: 360, height: 0, x: 0, y: 0 } } }));
  }
  return utils;
}

beforeEach(() => {
  mockQuery = {};
  mockPhotoUrl = {};
  mockPhotoUrlCalls.length = 0;
});

afterEach(async () => {
  await act(() => setLanguagePreference('system'));
});

describe('public share page — states', () => {
  it('shows "try again later" when the read is rate limited', () => {
    mockQuery = { isError: true, error: new MockShareLinkError('rate_limited', 'slow down', 429) };
    const { getByText } = renderPage();
    expect(getByText(i18n.t('share:page.busyTitle'))).toBeTruthy();
    expect(getByText(i18n.t('share:page.busyBody'))).toBeTruthy();
  });

  it('treats rate_limit_unavailable the same way', () => {
    mockQuery = { isError: true, error: new MockShareLinkError('rate_limit_unavailable', 'down', 503) };
    expect(renderPage().getByText(i18n.t('share:page.busyTitle'))).toBeTruthy();
  });

  it('shows a retryable error for other failures, and "link not found" for a revoked link', () => {
    mockQuery = { isError: true, error: new Error('network') };
    expect(renderPage().getByText(i18n.t('share:page.errorTitle'))).toBeTruthy();
    mockQuery = { data: null };
    expect(renderPage().getByText(i18n.t('share:page.notFoundTitle'))).toBeTruthy();
  });

  it('shows a skeleton while loading', () => {
    mockQuery = { isLoading: true };
    expect(renderPage().getByLabelText(i18n.t('share:page.loading'))).toBeTruthy();
  });
});

describe('public share page — sections', () => {
  it('renders only the itinerary when the other sections are absent (≈ on estimated legs)', () => {
    mockQuery = { data: payload() };
    const { getByText, queryByText, getAllByText } = renderPage();
    expect(getByText('Belém Tower')).toBeTruthy();
    expect(getAllByText(/^↓ ≈ /).length).toBe(1);
    expect(queryByText(i18n.t('share:expenses.title'))).toBeNull();
    expect(queryByText(i18n.t('share:memories.title'))).toBeNull();
    expect(queryByText(i18n.t('share:page.hiddenTitle'))).toBeNull();
  });

  it('says "hidden by the owner" when the itinerary is off', () => {
    mockQuery = { data: payload({ places: [], legs: [], sections: { itinerary: false, expenses: false, memories: false } }) };
    const { getByText, queryByText } = renderPage();
    expect(getByText(i18n.t('share:page.hiddenTitle'))).toBeTruthy();
    expect(queryByText(i18n.t('share:timeline.empty'))).toBeNull();
    expect(queryByText('Powered by Google')).toBeNull();
  });

  it('renders the expense summary in the home currency with the per-currency breakdown', () => {
    mockQuery = {
      data: payload({
        sections: { itinerary: true, expenses: true, memories: false },
        expenses: {
          homeCurrency: 'TRY',
          count: 3,
          totals: { actual: 1500, estimated: 0 },
          byCategory: [
            { category: 'food', actual: 1000, estimated: 0 },
            { category: 'transport', actual: 500, estimated: 0 },
          ],
          byCurrency: [
            { currency: 'TRY', actual: 500, estimated: 0, count: 1 },
            { currency: 'EUR', actual: 25, estimated: 0, count: 2 },
          ],
          pending: { count: 1, actualByCurrency: { USD: 10 }, estimatedByCurrency: {} },
        },
      }),
    };
    const { getByText } = renderPage();
    expect(getByText(i18n.t('share:expenses.title'))).toBeTruthy();
    expect(getByText(formatMoney(1500, 'TRY'))).toBeTruthy();
    expect(getByText(formatMoney(25, 'EUR'))).toBeTruthy();
    expect(getByText(i18n.t('share:expenses.category.food'))).toBeTruthy();
    expect(getByText(i18n.t('share:expenses.pending', { count: 1 }))).toBeTruthy();
  });

  it('renders memories and opens the lightbox with the full image of THAT photo', () => {
    mockQuery = { data: payload({ sections: { itinerary: true, expenses: false, memories: true }, memories: MEMORIES }) };
    const utils = renderPage();
    expect(utils.getByText(i18n.t('share:memories.title'))).toBeTruthy();
    expect(utils.getByText('We got lost in Alfama and loved it.')).toBeTruthy();
    expect(utils.getByLabelText(i18n.t('share:memories.rating', { rating: 4 }))).toBeTruthy();
    // Grid tiles never request full-size URLs.
    expect(mockPhotoUrlCalls).toEqual([]);

    fireEvent.press(utils.getByRole('button', { name: i18n.t('share:memories.openPhoto', { n: 2, total: 2 }) }));
    expect(mockPhotoUrlCalls).toContainEqual([TOKEN, 'ph2']);
    expect(utils.getByRole('button', { name: i18n.t('share:memories.lightbox.prev') })).toBeTruthy();
    expect(utils.queryByRole('button', { name: i18n.t('share:memories.lightbox.next') })).toBeNull();
  });

  it('keeps the preview and says "try later" when the full photo is rate limited', () => {
    mockPhotoUrl = { isError: true, error: new MockShareLinkError('rate_limited', 'slow', 429) };
    mockQuery = { data: payload({ sections: { itinerary: true, expenses: false, memories: true }, memories: MEMORIES }) };
    const utils = renderPage();
    fireEvent.press(
      utils.getByRole('button', { name: i18n.t('share:memories.openPhotoCaption', { n: 1, total: 2, caption: 'Sunset' }) }),
    );
    expect(utils.getByText(i18n.t('share:memories.lightbox.busy'))).toBeTruthy();
  });

  it('shows the memories empty state when the section is on but empty', () => {
    mockQuery = {
      data: payload({
        sections: { itinerary: true, expenses: false, memories: true },
        memories: { journal: [], reviews: [], photos: [], photoUrlExpiresAt: null, truncated: false },
      }),
    };
    expect(renderPage().getByText(i18n.t('share:memories.empty'))).toBeTruthy();
  });

  it('renders in Turkish', async () => {
    await act(() => setLanguagePreference('tr'));
    mockQuery = { data: payload({ places: [], legs: [], sections: { itinerary: false, expenses: false, memories: false } }) };
    const { getByText } = renderPage();
    expect(getByText('Gezi planı sahibi tarafından gizlendi')).toBeTruthy();
    const overline = getByText('Paylaşılan gezi · salt okunur');
    expect(within(overline.parent!).queryByText('Shared trip · read-only')).toBeNull();
  });
});
