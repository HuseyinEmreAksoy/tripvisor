/**
 * Discover cards + attribution (M5 Y3.4): interests render as labels, wiki
 * cards link the article with the CC BY-SA note, the OSM credit is always
 * a link.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { ReactElement } from 'react';
import { ThemeProvider } from '@/theme';
import { i18n } from '@/i18n';
import type { PoiItem } from '@/api/recommendations';
import { DiscoverCard } from '../DiscoverCard';
import { DiscoverAttribution } from '../DiscoverStates';
import { InterestChips } from '../InterestChips';

jest.mock('@/lib/haptics', () => ({
  haptics: { tap: jest.fn(), impact: jest.fn(), select: jest.fn(), success: jest.fn(), error: jest.fn() },
}));

const t = i18n.t.bind(i18n);
const wrap = (node: ReactElement) => render(<ThemeProvider>{node}</ThemeProvider>);

const galata: PoiItem = {
  id: 'osm:way/1',
  source: 'osm',
  osm: { type: 'way', id: 1 },
  name: 'Galata Tower',
  originalName: 'Galata Kulesi',
  lat: 41.0256,
  lng: 28.9742,
  distanceM: 850,
  interests: ['history', 'viewpoints'],
  kind: 'historic=tower',
  tags: {},
  wikidata: 'Q1',
  wiki: {
    lang: 'en',
    title: 'Galata Tower',
    extract: 'A medieval stone tower in Istanbul.',
    description: null,
    thumbUrl: null,
    url: 'https://en.wikipedia.org/wiki/Galata_Tower',
  },
  score: 0.9,
};

describe('DiscoverCard', () => {
  it('shows name, local name, interests, extract and opens on press', () => {
    const onOpen = jest.fn();
    const { getByText, getByRole } = wrap(<DiscoverCard item={galata} onOpen={onOpen} />);
    expect(getByText('Galata Tower')).toBeTruthy();
    expect(getByText(t('discover:card.localName', { name: 'Galata Kulesi' }))).toBeTruthy();
    expect(getByText(t('discover:interests.history'))).toBeTruthy();
    expect(getByText(t('discover:interests.viewpoints'))).toBeTruthy();
    expect(getByText('A medieval stone tower in Istanbul.')).toBeTruthy();
    fireEvent.press(getByRole('button', { name: /Galata Tower/ }));
    expect(onOpen).toHaveBeenCalledWith(galata);
  });

  it('links the Wikipedia article with the CC BY-SA note', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { getByRole, getByText } = wrap(<DiscoverCard item={galata} onOpen={jest.fn()} />);
    expect(getByText(/CC BY-SA/)).toBeTruthy();
    fireEvent.press(getByRole('link', { name: t('discover:wiki.readMoreA11y', { name: 'Galata Tower' }) }));
    expect(open).toHaveBeenCalledWith('https://en.wikipedia.org/wiki/Galata_Tower');
    open.mockRestore();
  });

  it('has no wiki link for OSM-only cards', () => {
    const { queryByRole } = wrap(<DiscoverCard item={{ ...galata, wiki: null }} onOpen={jest.fn()} />);
    expect(queryByRole('link')).toBeNull();
  });
});

describe('DiscoverAttribution', () => {
  it('always links OpenStreetMap, and the Wikipedia licence when present', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { getByText, getByRole, rerender } = wrap(
      <DiscoverAttribution
        attribution={{
          osm: '© OpenStreetMap contributors',
          osmUrl: 'https://www.openstreetmap.org/copyright',
          wikipedia: 'Wikipedia (CC BY-SA 4.0)',
          wikipediaUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
        }}
      />,
    );
    expect(getByText('© OpenStreetMap contributors')).toBeTruthy();
    fireEvent.press(getByRole('link', { name: t('discover:attribution.osmA11y', { text: '© OpenStreetMap contributors' }) }));
    expect(open).toHaveBeenCalledWith('https://www.openstreetmap.org/copyright');
    expect(getByText(t('discover:attribution.wiki'))).toBeTruthy();

    rerender(
      <ThemeProvider>
        <DiscoverAttribution
          attribution={{ osm: '© OpenStreetMap contributors', osmUrl: 'https://www.openstreetmap.org/copyright', wikipedia: null, wikipediaUrl: null }}
        />
      </ThemeProvider>,
    );
    expect(getByText('© OpenStreetMap contributors')).toBeTruthy();
    open.mockRestore();
  });
});

describe('InterestChips', () => {
  it('is a set of checkboxes that toggle', () => {
    const onChange = jest.fn();
    const { getByRole } = wrap(<InterestChips value={['food']} onChange={onChange} />);
    const food = getByRole('checkbox', { name: t('discover:interests.food') });
    expect(food.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    fireEvent.press(getByRole('checkbox', { name: t('discover:interests.history') }));
    expect(onChange).toHaveBeenCalledWith(['history', 'food']);
  });
});
