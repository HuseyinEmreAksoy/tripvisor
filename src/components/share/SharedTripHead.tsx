/**
 * SharedTripHead — per-trip Open Graph / Twitter meta for the public share
 * page (web only; a no-op on native).
 *
 * `expo-router/head` is required at runtime inside the web branch so it never
 * evaluates in the native bundle (same pattern as trip/[id]/print.tsx).
 * Rendered only once trip data has loaded — loading / not-found states keep
 * the root-layout baseline tags rather than advertising a revoked trip.
 *
 * Note: with `web.output: "static"` the /share/[token] HTML is prerendered
 * without trip data, so these tags are applied client-side after hydration.
 * JS-executing unfurlers (iMessage, Slack's renderer, Google) pick them up;
 * pure-HTML crawlers see the baseline tags.
 */
import { Platform } from 'react-native';
import { buildSummary, type SharedPlace, type SharedTripMeta } from '@/lib/buildSummary';

interface Props {
  trip: SharedTripMeta;
  places: SharedPlace[];
  /** Absolute canonical URL of this share page, when known. */
  url?: string;
}

export function SharedTripHead({ trip, places, url }: Props) {
  if (Platform.OS !== 'web') return null;

  const tripTitle = trip.title || 'Untitled trip';
  const summary = buildSummary(places, trip);

  // expo-router/head exports `Head` as the default export only; fall back to
  // `.Head` for any future SDK that re-adds a named export.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const headModule = require('expo-router/head') as {
    default?: React.ComponentType<{ children: React.ReactNode }>;
    Head?: React.ComponentType<{ children: React.ReactNode }>;
  };
  const Head = headModule.default ?? headModule.Head;
  if (!Head) return null;

  return (
    <Head>
      <title>{`${tripTitle} · Tripvisor`}</title>
      <meta name="description" content={summary} />
      <meta property="og:title" content={`${tripTitle} · Tripvisor`} />
      <meta property="og:description" content={summary} />
      <meta property="og:type" content="article" />
      <meta property="og:site_name" content="Tripvisor" />
      {url ? <meta property="og:url" content={url} /> : null}
      {url ? <link rel="canonical" href={url} /> : null}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={`${tripTitle} · Tripvisor`} />
      <meta name="twitter:description" content={summary} />
    </Head>
  );
}
