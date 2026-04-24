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
export const noTrips: Pick<EmptyStateProps, 'title' | 'body' | 'ctaLabel'> = {
  title: 'Plan your first trip',
  body: "Add places, set a budget, and we'll split your days.",
  ctaLabel: 'New trip',
};

/** Itinerary tab — a trip exists but has no places added yet. */
export const noPlaces: Pick<EmptyStateProps, 'title' | 'body' | 'ctaLabel'> = {
  title: 'Add your first place',
  body: 'Search for a place to kick off your itinerary.',
  ctaLabel: 'Add a place',
};

/** Add-place screen — input is non-empty but autocomplete returned nothing. */
export const noSearchResults: Pick<EmptyStateProps, 'title' | 'body'> = {
  title: 'No results',
  body: 'Try another query or tweak the spelling.',
};

/** Add-place screen — input is blank; prompt the user to start typing. */
export const searchPrompt: Pick<EmptyStateProps, 'title' | 'body'> = {
  title: 'Search for a place',
  body: 'Type a name, address, or landmark.',
};
