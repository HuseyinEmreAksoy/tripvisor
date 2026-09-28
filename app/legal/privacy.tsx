/**
 * Public privacy policy (v2 M4 X3.2). Outside the auth guard: linked from the
 * Play listing / Data-safety form, signup, and Profile & settings.
 */
import type { Href } from 'expo-router';
import { LegalDocument, LEGAL_CONTACT_EMAIL, type LegalSection } from '@/components/legal/LegalDocument';

const SECTIONS: LegalSection[] = [
  {
    heading: 'Who we are',
    paragraphs: [
      'Tripvisor is a free, non-commercial holiday route planner built and run by an individual developer. There are no ads, no paid tiers and no selling of data. “We” below means that developer.',
    ],
  },
  {
    heading: 'What we collect',
    bullets: [
      'Account: your email address, used to sign you in (by email link or Google sign-in) and to contact you about your account. If you sign in with Google we receive your email and basic profile name, nothing else.',
      'Content you enter: trips, dates, places, notes, pinned times, packing lists, accommodation, budgets and expenses.',
      'Places: for each place you add we store its Google place ID and its coordinates. Names, photos, ratings and reviews from Google are fetched when you view them and are not stored on our servers.',
      'Documents you upload to a trip: PDFs and images such as tickets or booking confirmations. They are stored privately in our file storage and are visible only to that trip’s members.',
      'Collaboration: who you share a trip with, their role, and share links you create.',
      'Crash reports and performance data: if the app crashes, a report with the error, device type, OS and app version is sent to Sentry, along with a small sample of performance traces (how long screens and requests take). It doesn’t include your trip content.',
    ],
    paragraphs: [
      'We do not collect your contacts, advertising ID or browsing history, and we do not track you across other apps or websites.',
    ],
  },
  {
    heading: 'Your location',
    paragraphs: [
      'Only if you ask for it (“How far am I?” on Today, or “From my location” on the map), the app reads your current position on your device to estimate distance or draw a line to your first stop. Your location is not saved to your account or sent to our servers. You can turn location access off at any time in your phone or browser settings.',
    ],
  },
  {
    heading: 'How we use your data',
    bullets: [
      'To run the app: store and sync your trips across your devices, and share them with the people you invite.',
      'To plan routes and suggestions: place names, coordinates and the text you type are sent to the services listed below.',
      'To fix bugs: crash reports help us find and fix problems.',
    ],
    paragraphs: ['We never sell your data or use it for advertising or profiling.'],
  },
  {
    heading: 'Services that process data for us',
    bullets: [
      'Supabase: database, sign-in and server functions. Stores your account and trip data.',
      'Google Maps Platform: place search, place details and route times. Receives search text, place IDs and coordinates. Results aren’t stored beyond place IDs and coordinates.',
      'Google Gemini and Groq: AI trip planning and editing. They receive only the text you write in the AI planner and the names of places in the trip, never your email.',
      'OpenRouteService: route optimisation and travel times. Receives coordinates.',
      'Open-Meteo: weather forecasts. Receives coordinates and dates.',
      'OpenFreeMap / OpenStreetMap: map tiles for the web map. The tile servers receive your IP address and the map area you are viewing.',
      'Google Maps SDK: draws the map in the Android app. Google receives device and map-usage data under its own terms and privacy policy.',
      'Cloudflare Pages: hosts the web app; processes standard request data such as IP address to serve pages.',
      'Sentry: crash reports and a sample of performance traces, as described above.',
    ],
    paragraphs: [
      'Some of these providers are based outside your country, including the United States. They process data under their own privacy terms and only to provide their service to us.',
    ],
  },
  {
    heading: 'How long we keep it',
    paragraphs: [
      'Your data is kept for as long as you have an account. When you delete your account, your account and your trips, including their places, expenses, share links and the documents and files uploaded to them, are deleted straight away; backups roll over within 30 days. Data saved on your device is wiped when you delete your account, or you can remove it by uninstalling the app or clearing site data.',
    ],
  },
  {
    heading: 'Your choices and rights',
    bullets: [
      'Export: Profile & settings → Your data → Export my data downloads everything as a JSON file.',
      'Delete: Profile & settings → Delete account permanently removes your account and all your trips. You can also email us to ask for deletion.',
      'Correct: you can edit or delete any trip, place or expense in the app at any time.',
      `Ask: you can request a copy of your data, correction or deletion by emailing ${LEGAL_CONTACT_EMAIL}. Depending on where you live (for example the EU/UK under GDPR) you may also complain to your data-protection authority.`,
    ],
  },
  {
    heading: 'Security',
    paragraphs: [
      'Data is encrypted in transit (HTTPS). Database access rules make sure only you and the people you share a trip with can read it. No system is perfectly secure, so please don’t store sensitive personal information (such as passport numbers) in trip notes.',
    ],
  },
  {
    heading: 'Children',
    paragraphs: ['Tripvisor is not directed at children under 13, and we don’t knowingly collect their data.'],
  },
  {
    heading: 'Changes',
    paragraphs: [
      'If this policy changes in a meaningful way we’ll update the date above and mention it in the app. The current version always lives at this page.',
    ],
  },
];

export default function PrivacyPolicy() {
  return (
    <LegalDocument
      title="Privacy policy"
      intro="This policy explains what Tripvisor collects, why, who processes it, and how you can export or delete it. The short version: we keep only what the app needs to plan and sync your trips, and we never sell it."
      sections={SECTIONS}
      related={{ label: 'Read the terms of use', href: '/legal/terms' as Href }}
    />
  );
}
