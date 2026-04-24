# ics-export

**Status**: 🚧 Code complete · awaiting native smoke
**Owner agents**: backend-specialist, ui-specialist
**Depends on**: trip-crud, day-split

## Platforms verified
- ☐ iOS
- ☐ Android
- ☐ Web
(Check a box only after smoke-testing on that platform.)

## User story
As a trip planner, I want to export my itinerary as a `.ics` file so I can import it into Google Calendar, Apple Calendar, or Outlook.

## UI
- **Settings tab** (`app/(app)/trip/[id]/index.tsx`): "Export to calendar (.ics)" button. Disabled (with updated `accessibilityLabel`) when `trip_places` is empty.
- Success toast on download; error toast on failure.
- Platform difference:
  - Web: `useDownloadTripIcs` in `src/api/ics.web.ts` creates a `Blob`, attaches it to a temporary `<a download>` element, and triggers a click. Throws `new Error('Browser not available for download')` if `window`/`document` are undefined (SSR/worker context) so the caller surfaces a proper error state rather than a silent no-file toast.
  - Native: `src/api/ics.native.ts` writes the file via `expo-file-system` then opens the system share sheet via `expo-sharing`.

## Data
- No new tables or columns.
- Generator reads: `trip.start_date`, `trip.timezone`, `trip_places.day_index`, `trip_places.order_in_day`, `trip_places.visit_duration_minutes`, `trip_places.name`, `trip_places.lat`, `trip_places.lng`.
- No Google Place Detail data (reviews, photos, hours) is written to the file — only fields already stored in `trip_places`.

## APIs
- No new Edge Function or Google API calls. The `.ics` string is generated client-side by the pure function `tripToIcs` in `src/lib/ics/generate.ts`.

## Generator contract (`tripToIcs`)
- **RFC 5545** compliant: VCALENDAR wrapper, PRODID, VERSION 2.0, one VEVENT per place.
- **Line endings**: CRLF throughout. The golden fixture (`src/lib/ics/__tests__/__fixtures__/sample.ics`) is committed with forced CRLF via `.gitattributes` (`*.ics text eol=crlf`) so Linux CI checkouts do not corrupt the byte-exact comparison.
- **Folding**: lines > 75 octets are folded with CRLF + single space per RFC 5545 section 3.1.
- **Timezone**: `DTSTART;TZID=<trip.timezone>` with a bundled `VTIMEZONE` block for ~20 common IANA zones. Falls back to `DTSTART:<...>Z` (absolute UTC) when `trip.timezone` is null or unrecognized — never emits floating local time.
- **Event anchoring**: `DTSTART` = `trip.start_date` + `day_index * 24 h` + cumulative `visit_duration_minutes` of prior places in the same day.
- **File name**: `tripvisor-<trip_slug>.ics` (slug sanitized to `[a-z0-9-]+`).

## Edge cases
- Trip with no places: button is disabled; `tripToIcs` would produce a calendar with zero VEVENTs (not called).
- Trip with no `start_date`: event times anchor to a synthetic day-zero date; the user is notified via the error toast (expected to be rare — `start_date` is required at trip creation).
- Unknown IANA timezone: falls back to UTC absolute. Covered by unit test.
- SSR / worker context on web: `ics.web.ts` throws rather than silently returning a 0-byte result — the React Query `onError` path fires the error toast.

## Test plan
- Unit: `src/lib/ics/__tests__/generate.test.ts` — 25 cases covering golden-file fixture byte comparison, VTIMEZONE selection, UTC fallback, folding, escaping, zero-place guard ✅
- Component: export button disabled when `trip_places` is empty; `accessibilityState.disabled` set correctly ✅
- E2E (Playwright): `e2e/web/phase-4-polish.spec.ts` Check 3 — export button visible + `page.waitForEvent('download')` confirms non-empty file ✅
- Manual native smoke (iOS + Android): tap export, system share sheet opens with `.ics` attachment; import into calendar app — deferred to user

## ADR
- [ADR-0004 — .ics timezone policy](../adr/0004-ics-timezone-policy.md)

## Review
- [Phase 4 review — Problem 3 (CRLF .gitattributes), Problem 7 (SSR download path)](../reviews/phase-4.md)
