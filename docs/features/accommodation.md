# accommodation

**Status**: 🚧 In progress — shipped Phase 21 (2026-04-25); Phase 22 hardening shipped 2026-04-26 (Google Places autocomplete wired in edit sheet); web smoke pending (skipped per user direction).
**Owner agents**: backend-specialist (data layer), ui-specialist (UI)
**Depends on**: trip-crud, collaboration

## Platforms verified
- ☐ iOS — smoke not yet run
- ☐ Android — smoke not yet run
- ☐ Web — smoke explicitly skipped per user direction 2026-04-25
(Automated tests and live smoke were skipped for Phase 21 per user direction. No platform box may be ticked until smoke is run.)

## User story
As a trip planner, I want to attach accommodation bookings (hotel, Airbnb, hostel, etc.) to date ranges within my trip, so I can see where I'll be staying on each day of the itinerary and share that context with collaborators.

## UI

### Screens and components

All components live in `src/components/accommodation/`:

- **`AccommodationList.tsx`** — list of accommodation cards on the trip detail Settings tab. Each card shows property name, date range (check-in to check-out), and address line. Tapping a card opens the edit sheet.
- **`AccommodationCard.tsx`** — individual card within `AccommodationList`.
- **`AccommodationEditSheet.tsx`** — create/edit bottom sheet. Includes a Google Places search input (Phase 22): `usePlacesAutocomplete` + `usePlaceDetails` wired with one `sessionToken` per sheet mount (via `useState(crypto.randomUUID)`). Suggestions list shows up to 5 results with day-color accents; tapping a suggestion fetches place details and populates `name` / `address` / `google_place_id` / `lat` / `lng`. A "Linked: <name>" chip with an X unlinks the place and restores manual address entry. `PlacesError` (including `server_misconfigured`) is caught and rendered as an inline warning pointing to `docs/google-maps-setup.md`; the sheet does not crash. Manual name and address fields are preserved as fallback when no place is linked. Check-in and check-out date pickers, notes field. Check-out must be after check-in (validated client-side; enforced by DB CHECK constraint).
- **`StayingAtPill.tsx`** — small chip rendered near each day header in the itinerary when an accommodation covers that night. Text: "Staying at: <name>".

`AccommodationList` and `StayingAtPill` are integrated into `app/(app)/trip/[id]/index.tsx`.

### Key interactions

- Add accommodation: tap "+ Add accommodation" button in the Settings tab (hidden for viewer role).
- The sheet prompts for name, optional address, check-in / check-out dates, and optional notes.
- After saving, cards appear in the Settings tab list and `StayingAtPill` chips appear on the relevant day headers.
- Edit: tap any card; the same sheet reopens pre-filled.
- Delete: available from within the edit sheet (hidden for viewer role).

### Platform differences

No native-specific surface. `AccommodationEditSheet` uses the same bottom-sheet primitive as other edit sheets in the app. Date pickers use the standardized cross-platform date picker from Phase 20.

## Data

### `trip_accommodations` table (migrations `0012` + `0013`)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid pk` | `gen_random_uuid()` |
| `trip_id` | `uuid fk trips` | cascade on delete |
| `name` | `text not null` | hotel / property name |
| `google_place_id` | `text null` | optional Google place anchor |
| `address` | `text null` | free-text fallback or resolved address |
| `lat` | `numeric null` | required if `google_place_id` is not null |
| `lng` | `numeric null` | required if `google_place_id` is not null |
| `check_in_date` | `date not null` | |
| `check_out_date` | `date not null` | CHECK `check_out_date > check_in_date` |
| `notes` | `text null` | free text |
| `created_at` | `timestamptz` | `now()` |
| `updated_at` | `timestamptz` | maintained by `set_updated_at` trigger |

**CHECK constraints**:
- `check_out_date > check_in_date`
- `(google_place_id IS NULL) OR (lat IS NOT NULL AND lng IS NOT NULL)`

**Index**: `(trip_id, check_in_date)`.

**RLS** (migration `0013` rewrites owner-only policies from `0012`):
- SELECT: `user_can_access_trip(trip_id, auth.uid(), 'viewer')`
- INSERT / UPDATE / DELETE: `user_can_access_trip(trip_id, auth.uid(), 'editor')`

### Google ToS compliance

Only `google_place_id`, `lat`, and `lng` are persisted server-side — same pattern as `trip_places`. No reviews, photos, opening hours, phone, or website are stored. Accommodation cost flows through `trip_expenses` in the `accommodation` category, not this table.

## APIs

- `src/api/places.ts` — `usePlacesAutocomplete` + `usePlaceDetails` consumed by `AccommodationEditSheet` (Phase 22). Session token generated once per sheet mount via `useState(crypto.randomUUID)` and shared across both calls. `PlacesError` with code `server_misconfigured` is handled inline.
- `src/api/trip-accommodations.ts` — Zod schema + `TripAccommodation` type; TanStack Query hooks:
  - `useTripAccommodations(tripId)` — reads all accommodations for a trip, ordered by `check_in_date`
  - `useCreateTripAccommodation()` — inserts a new accommodation row (optimistic + rollback)
  - `useUpdateTripAccommodation()` — updates any field (optimistic + rollback)
  - `useDeleteTripAccommodation()` — deletes an accommodation row (optimistic + rollback)
- Query keys in `src/api/_keys.ts` (`tripAccommodationsKeys`).

## Edge cases

- **Overlapping date ranges**: two accommodations covering the same night are allowed by the DB (no overlap enforcement). The UI does not warn about overlaps in v1 — this is a Phase 22 candidate. Both `StayingAtPill` entries would appear on the shared night's day header.
- **`check_out_date > check_in_date`**: enforced by both the DB CHECK constraint and client-side Zod validation. Same-day check-in/out is rejected.
- **Optional Google place link**: when `google_place_id` is null, only `name` and `address` are required. When `google_place_id` is supplied, `lat` and `lng` must also be provided (CHECK constraint ensures this).
- **Accommodation edit sheet autocomplete**: wired in Phase 22 — see `AccommodationEditSheet.tsx` description above. Autocomplete and place-details calls share one session token per sheet mount; manually editing the address after a place is linked clears the `google_place_id`/`lat`/`lng` (same UX as `add.tsx`). `server_misconfigured` error surfaces inline without crashing the sheet.
- **Viewer role**: viewer collaborators can see accommodation cards and `StayingAtPill` chips but cannot add, edit, or delete.
- **Deleting a trip**: cascades to `trip_accommodations` via the FK.

## Test plan (deferred — Phase 21 tests skipped per user direction)

- Unit: Zod schema validation (check_out <= check_in rejected; missing lat/lng with google_place_id rejected).
- Integration (RLS): viewer can SELECT, editor can INSERT, non-member gets 0 rows.
- Component: `StayingAtPill` renders correct name when accommodation covers the day's index; absent when no accommodation covers it.
- E2E (web Playwright): create a 3-night stay; verify pill on three day headers; edit name; delete stay; verify pills removed.
- Manual native smoke (iOS + Android): deferred.

## Known limitations
1. ~~`AccommodationEditSheet` does not wire Google Places autocomplete~~ — resolved Phase 22; autocomplete + place-details wired with sessionToken, "Linked: <name>" chip, graceful `PlacesError` fallback, and manual address fallback.
2. Overlapping date ranges are allowed at the DB level — no overlap warning in v1.
3. `StayingAtPill` uses a simple date-range inclusion check based on `check_in_date` / `check_out_date`; it surfaces on every night between check-in and check-out (exclusive of check-out night, matching hotel convention).
