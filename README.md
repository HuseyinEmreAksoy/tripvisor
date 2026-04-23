# Tripvisor

Tripvisor is a universal Expo app for planning trips across iOS, Android, and web from one codebase. It combines Supabase for auth/data, Google Places for search and live place details, and a route optimizer that splits trips across days.

## Current status

- Phase 3 in progress
- Core app structure, auth, trip CRUD, place search, place details, and optimization code are present
- End-to-end cloud setup still depends on real Supabase and Google Maps credentials

## Stack

- Expo SDK 52 + Expo Router
- React Native + React Native Web
- TypeScript
- Supabase (Postgres, Auth, Edge Functions)
- Google Maps Platform (Places API New, Routes API, Maps JS / native SDKs)
- TanStack Query

## Project structure

- `app/`: Expo Router screens
- `src/`: shared app code, components, API wrappers, theme, optimizer
- `supabase/`: SQL migrations and Edge Functions
- `docs/`: architecture, feature docs, review notes, ADRs
- `plan.md`: roadmap and delivery status

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Fill in client env vars in `.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY=
```

3. Initialize and link Supabase:

```bash
npx supabase init
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

4. Deploy edge functions and set secrets:

```bash
npx supabase functions deploy places-autocomplete place-details directions-polyline distance-matrix optimize-trip
npx supabase secrets set GOOGLE_MAPS_SERVER_KEY=...
npx supabase secrets set ALLOWED_ORIGINS=http://localhost:8081,https://your-host.com
```

5. Run the app:

```bash
npm run web
```

## Native notes

- Expo Go is not supported because the project uses `react-native-maps`
- Development builds are configured through `eas.json`
- Native Google Maps SDK keys still need to be set in `app.json`

## Docs

- [plan.md](./plan.md)
- [docs/architecture.md](./docs/architecture.md)
- [docs/features/overview.md](./docs/features/overview.md)
