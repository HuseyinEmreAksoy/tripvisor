/**
 * Bundled translation resources (ADR-0011 §2): statically imported so the
 * app works offline and Metro includes every string in the bundle.
 *
 * Every M5 namespace is registered up front, so parallel feature steps only
 * ever edit their OWN `locales/{en,tr}/<ns>.json` and never this file. Adding
 * a brand-new namespace is the only reason to touch it (both languages, plus
 * the `NAMESPACES` list). English is the source of truth for key typing.
 */
import enAi from './locales/en/ai.json';
import enAuth from './locales/en/auth.json';
import enCollab from './locales/en/collab.json';
import enCommon from './locales/en/common.json';
import enDiscover from './locales/en/discover.json';
import enErrors from './locales/en/errors.json';
import enHome from './locales/en/home.json';
import enInsights from './locales/en/insights.json';
import enLegal from './locales/en/legal.json';
import enMemories from './locales/en/memories.json';
import enMoney from './locales/en/money.json';
import enOnboarding from './locales/en/onboarding.json';
import enPacking from './locales/en/packing.json';
import enPlace from './locales/en/place.json';
import enProfile from './locales/en/profile.json';
import enRecap from './locales/en/recap.json';
import enRoutes from './locales/en/routes.json';
import enShare from './locales/en/share.json';
import enShell from './locales/en/shell.json';
import enStays from './locales/en/stays.json';
import enToday from './locales/en/today.json';
import enTrip from './locales/en/trip.json';
import trAi from './locales/tr/ai.json';
import trAuth from './locales/tr/auth.json';
import trCollab from './locales/tr/collab.json';
import trCommon from './locales/tr/common.json';
import trDiscover from './locales/tr/discover.json';
import trErrors from './locales/tr/errors.json';
import trHome from './locales/tr/home.json';
import trInsights from './locales/tr/insights.json';
import trLegal from './locales/tr/legal.json';
import trMemories from './locales/tr/memories.json';
import trMoney from './locales/tr/money.json';
import trOnboarding from './locales/tr/onboarding.json';
import trPacking from './locales/tr/packing.json';
import trPlace from './locales/tr/place.json';
import trProfile from './locales/tr/profile.json';
import trRecap from './locales/tr/recap.json';
import trRoutes from './locales/tr/routes.json';
import trShare from './locales/tr/share.json';
import trShell from './locales/tr/shell.json';
import trStays from './locales/tr/stays.json';
import trToday from './locales/tr/today.json';
import trTrip from './locales/tr/trip.json';

export const DEFAULT_NS = 'common';

export const en = {
  ai: enAi,
  auth: enAuth,
  collab: enCollab,
  common: enCommon,
  discover: enDiscover,
  errors: enErrors,
  home: enHome,
  insights: enInsights,
  legal: enLegal,
  memories: enMemories,
  money: enMoney,
  onboarding: enOnboarding,
  packing: enPacking,
  place: enPlace,
  profile: enProfile,
  recap: enRecap,
  routes: enRoutes,
  share: enShare,
  shell: enShell,
  stays: enStays,
  today: enToday,
  trip: enTrip,
} as const;

export type Namespace = keyof typeof en;

// Typed against `en` so a namespace missing from Turkish is a tsc error.
// Key-level parity (and empty values) is enforced by `npm run i18n:check`.
const tr: Record<Namespace, object> = {
  ai: trAi,
  auth: trAuth,
  collab: trCollab,
  common: trCommon,
  discover: trDiscover,
  errors: trErrors,
  home: trHome,
  insights: trInsights,
  legal: trLegal,
  memories: trMemories,
  money: trMoney,
  onboarding: trOnboarding,
  packing: trPacking,
  place: trPlace,
  profile: trProfile,
  recap: trRecap,
  routes: trRoutes,
  share: trShare,
  shell: trShell,
  stays: trStays,
  today: trToday,
  trip: trTrip,
};

export const NAMESPACES = Object.keys(en) as Namespace[];

export const resources = { en, tr } as const;
