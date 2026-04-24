# ADR-0004: `.ics` timezone policy

**Status**: Accepted
**Date**: 2026-04-24

## Context

Phase 4 adds calendar export via `.ics`. The iCalendar spec (RFC 5545) allows three ways to express event times:

1. **Absolute UTC** — `DTSTART:<...>Z` — unambiguous but rendered in the viewer's local TZ
2. **Floating local** — `DTSTART:<...>` (no Z, no TZID) — means "this local time in whatever TZ the viewer is in"
3. **Named zone** — `DTSTART;TZID=<IANA zone>:<...>` + `VTIMEZONE` block — viewer renders in the named TZ

Tripvisor already stores `trip.timezone` as an IANA zone string (e.g. `Europe/Istanbul`).

## Decision

Emit `DTSTART;TZID=<trip.timezone>` with a corresponding `VTIMEZONE` block.

Fallback: if `trip.timezone` is null/empty, use absolute UTC — `DTSTART:<...>Z`.

Never emit floating local time.

## Alternatives considered

| Option | Pro | Con |
|---|---|---|
| Absolute UTC (`Z`) | Simple; zero VTIMEZONE overhead | Rendered in viewer's local TZ — shows wrong hours if user imports from a different TZ |
| Floating local | Easy to generate | Wrong on any device not in the trip's TZ; RFC 5545 explicitly warns against this for cross-TZ use |
| Named zone + VTIMEZONE (chosen) | Correct in all calendar apps; honours trip context | Must emit VTIMEZONE block; generator is slightly more complex |

## Consequences

- The `.ics` generator must include a `VTIMEZONE` component for every unique IANA zone referenced in the file.
- `TZID` values must be valid IANA zone identifiers — validate against the stored value before emitting.
- The fallback to UTC absolute must be exercised by unit tests (trip with no timezone set).
- Google Calendar, Apple Calendar, and Outlook all honour `TZID` — no known compatibility issue.
