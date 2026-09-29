/**
 * emptyStates.ts — Curated copy variants for EmptyState screens.
 *
 * Import a constant and spread it onto <EmptyState>:
 *   <EmptyState {...noTrips} onPress={handler} />
 *
 * ctaLabel / onPress are intentionally separated so each call site provides
 * the appropriate handler rather than baking it into the constant.
 */
import type { EmptyStateProps } from './EmptyState';

/** Trips list — the authenticated user has no trips yet. */
export const noTrips: Pick<EmptyStateProps, 'title' | 'body' | 'ctaLabel' | 'illustration'> = {
  title: 'Where to next?',
  body: 'Add places, set how many hours you want per day, and we\'ll build your perfect itinerary.',
  ctaLabel: 'Plan a trip',
  illustration: require('../../assets/images/empty-trips.png'),
};

/** Itinerary tab — a trip exists but has no places added yet. */
export const noPlaces: Pick<EmptyStateProps, 'title' | 'body' | 'ctaLabel' | 'illustration'> = {
  title: 'Add your first place',
  body: 'Search for a place to kick off your itinerary.',
  ctaLabel: 'Add a place',
  illustration: require('../../assets/images/empty-places.png'),
};

/** Add-place screen — input is non-empty but autocomplete returned nothing. */
export const noSearchResults: Pick<EmptyStateProps, 'title' | 'body' | 'illustration'> = {
  title: 'No results',
  body: 'Try another query or tweak the spelling.',
  illustration: require('../../assets/images/empty-search.png'),
};

/** Add-place screen — input is blank; prompt the user to start typing. */
export const searchPrompt: Pick<EmptyStateProps, 'title' | 'body' | 'illustration'> = {
  title: 'Search for a place',
  body: 'Type a name, address, or landmark.',
  illustration: require('../../assets/images/empty-search.png'),
};

/**
 * Illustration-only presets (M5 art pass). Copy stays at the call site so it
 * can go through `tx()`; spread or pass `illustration={…}` onto <EmptyState>.
 */
export const archiveArt = require('../../assets/images/empty-archive.png');
export const notFoundArt = require('../../assets/images/not-found.png');
export const peopleArt = require('../../assets/images/empty-people.png');
export const todayArt = require('../../assets/images/empty-today.png');
export const offlineArt = require('../../assets/images/offline.png');
