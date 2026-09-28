/**
 * Public terms of use (v2 M4 X3.2). Outside the auth guard: linked from the
 * store listing, signup, and Profile & settings.
 */
import type { Href } from 'expo-router';
import { LegalDocument, type LegalSection } from '@/components/legal/LegalDocument';

const SECTIONS: LegalSection[] = [
  {
    heading: 'The service',
    paragraphs: [
      'Tripvisor is a free hobby project for planning holiday routes: organising places into days, estimating travel times, drafting plans with AI, and sharing trips with friends. It is provided as-is, and features may change or be removed at any time.',
    ],
  },
  {
    heading: 'Your account',
    bullets: [
      'You need an email address (or Google account) to sign in. Keep access to that inbox secure; anyone who can read it can sign in as you.',
      'You must be at least 13 years old, or the minimum age for online services where you live.',
      'You can delete your account at any time from Profile & settings.',
    ],
  },
  {
    heading: 'Your content',
    paragraphs: [
      'Trips, notes, expenses and everything else you enter stay yours. You give us permission to store, process and display them only as needed to run the app for you and the people you share with. When you share a trip or create a share link, anyone with access can see that trip.',
    ],
  },
  {
    heading: 'Acceptable use',
    bullets: [
      'Don’t use Tripvisor for anything illegal, or to harass anyone.',
      'Don’t try to break, overload, scrape or reverse-engineer the service or its API quotas.',
      'Don’t upload content you don’t have the right to share.',
    ],
    paragraphs: ['We may suspend accounts that abuse the service, especially where it puts the free service at risk for everyone.'],
  },
  {
    heading: 'Maps, routes and AI suggestions',
    paragraphs: [
      'Travel times, opening hours, routes, weather and AI-drafted plans are estimates from third-party services (including Google Maps, OpenFreeMap/OpenStreetMap, OpenRouteService, Open-Meteo, Gemini and Groq). They can be wrong or out of date. Always check opening times, local conditions and safety information yourself, and follow road signs and local rules while travelling. Map data and place information are subject to the providers’ own terms, including the Google Maps Terms of Service and the OpenStreetMap licence.',
    ],
  },
  {
    heading: 'No warranty, limited liability',
    paragraphs: [
      'Tripvisor is provided free of charge, “as is” and “as available”, without warranties of any kind. To the extent the law allows, the developer is not liable for missed bookings, travel costs, lost data or any indirect loss arising from using the app. Keep your own copy of important bookings and documents; you can export your data at any time. Nothing here limits rights you have under consumer law that can’t be waived.',
    ],
  },
  {
    heading: 'Ending the service',
    paragraphs: [
      'You can stop using Tripvisor and delete your account whenever you like. If the service is ever shut down, we will give reasonable notice in the app where possible so you can export your trips.',
    ],
  },
  {
    heading: 'Changes to these terms',
    paragraphs: [
      'We may update these terms; the date above shows the latest version. Continuing to use the app after a change means you accept the updated terms.',
    ],
  },
];

export default function TermsOfUse() {
  return (
    <LegalDocument
      title="Terms of use"
      intro="These terms cover how you can use Tripvisor, a free travel planner. By creating an account or using the app you agree to them. How we handle your data is explained in the privacy policy."
      sections={SECTIONS}
      related={{ label: 'Read the privacy policy', href: '/legal/privacy' as Href }}
    />
  );
}
