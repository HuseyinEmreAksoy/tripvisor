# ADR-0012: Multi-currency — Frankfurter rates via an Edge Function, cached per day in Postgres, rate frozen per expense

**Status**: Accepted (planned in Phase M5, steps Y1.1 / Y1.3 / Y2.2)
**Date**: 2026-09-29

## Context

A traveller in Germany enters most expenses in EUR and some in TRY. They want everything totalled in their home (main) currency, plus a separate subtotal for each original currency. Today `trip_expenses.amount` has no currency: it implicitly uses `trips.currency`, which a check constraint limits to 5 codes. The FX source has to be free with no key, work at hobby scale, and support historical dates. Expense entry has to keep working offline (M4 X2.5 made expenses Tier-1 writable).

## Decision

1. **Source:** Frankfurter (`api.frankfurter.dev`). It needs no key, has no quotas (only abuse rate-limiting), is ECB-backed, has daily history, and includes TRY (https://frankfurter.dev/, checked 2026-09-29). The fallback source is `fawazahmed0/currency-api` via jsDelivr (also free with no key), used only when Frankfurter errors.
2. **Cache:** a new `fx_rates(base, quote, rate_date, rate, source, fetched_at)` table, PK `(base, quote, rate_date)`, always stored against base `EUR`. The **`fx-rates` Edge Function** serves `GET ?date=YYYY-MM-DD&from=XXX&to=YYY` (and `latest`). It reads Postgres first, fetches upstream only when a date is missing, upserts the whole day's rates in one call, and computes cross rates as `r(to)/r(from)`. Past dates never change, so they are cached permanently. Today's row is refreshed after 6 h. A weekend or holiday resolves to the last published date, which is stored under the requested date too. RLS: rates are readable by everyone authenticated, and only the service role writes them.
3. **Expense model (additive):** `trip_expenses` gains `currency` (original ISO code; `NULL` means legacy, i.e. the trip currency), `fx_rate` (home units per 1 original unit, frozen when the expense is entered), `fx_date`, and `fx_home_currency` (the home currency that `fx_rate` refers to). `amount` stays the original amount. `trips.currency` is the trip's **home currency**, and its check widens to `^[A-Z]{3}$`. The picker lists what `fx-rates` supports.
4. **Offline:** the last-known rate map is a Tier-2 query persisted through the TanStack persister allowlist (FX data is not Google data, so persisting it is allowed). With no cached rate, the expense saves with `fx_rate = NULL` and shows a "rate pending" chip. A reconciler in the expense facade fills it in on reconnect.
5. **Views:** totals in the home currency use the frozen rate by default, with an "at today's rate" toggle. There is also a per-original-currency breakdown. If `fx_home_currency ≠ trips.currency` (the home currency changed), the client re-derives the rate from `fx_rates` for `fx_date`. The analytics MV sums `amount * coalesce(fx_rate, 1)`.

## Alternatives considered

- **exchangerate.host:** now needs a key. **Open Exchange Rates:** needs a key and gives 1k calls a month. **open.er-api.com:** has no historical rates on the free tier.
- **Converting on the fly with no stored rate:** the historical total would drift every day. The user explicitly asked for the rate at expense time.
- **Storing only the converted amount:** this loses the per-currency breakdown and makes a home-currency change impossible to handle.

## Consequences

- At most about one upstream call per distinct date across all users. The `fx_rates` table grows by roughly 30–200 rows per day that anyone uses, which is negligible against the 500 MB DB limit.
- Every consumer of `trip_expenses.amount` (budget, analytics MV, duplicate_trip, export, share page) must become currency-aware. The M5 plan lists each of them.
