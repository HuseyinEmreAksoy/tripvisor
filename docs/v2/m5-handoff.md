# M5 handoff notes (orchestrator) — pass into Wave 2/3 briefs

## From Y1.1 (0034 money, 0035 leg modes)
- Deploy order: push 0034/0035 BEFORE any web/OTA with the new allowlist. The Tier-1 select names allowlisted columns, so if the app is ahead of the DB, the expenses/places/days tables return 400.
- fx_rates:
  - PK (base default 'EUR', quote, rate_date); rate > 0; source 1–64 chars.
  - Upper-case the quote and filter to ^[A-Z]{3}$ before upsert, because one bad row fails the whole batch.
  - Store the weekend/holiday rate under the requested date.
- Money conversion order (MV + Y2.2 lib must match; documented on the TripExpense JSDoc):
  1. Rate is 1 when the expense currency equals the current home currency.
  2. Otherwise use the frozen fx_rate, but only if fx_home_currency equals the current home.
  3. Otherwise recompute from fx_rates on fx_date.
  4. Otherwise fall back to amount*coalesce(fx_rate,1).
  - NULL currency means "trip currency at rate 1".
- Legacy expenses are backfilled to the trip currency at rate 1. An insert trigger fills a missing currency.
- Y2.2 gaps:
  - `src/api/trip-expenses.ts` create/update zod schemas drop the money fields, and the v1 row-schema parse strips them. Pass them through to syncCreateExpense.
  - Reconciler: updateExpense(id,{fx_rate,...}).
- Y2.3:
  - Write trip_legs.source (ors|google|estimate|user).
  - Effective mode = arrival_mode ?? day.transport_mode ?? trip.transport_mode.
  - trip_legs.transport_mode has no check (flight/ferry are fine).
- Y3.3:
  - Per-leg: useUpdateTripPlace({arrival_mode, arrival_minutes}). Clear both together.
  - Day default: useUpdateTripDay({trip_id, day_index, transport_mode}), online only.
  - Viewers are RLS-denied.
- Y3.2:
  - GRANT the one types.ts edit `export type TripCurrency = CurrencyCode;` and fix the zod enum in trip/new.tsx plus TripSettingsSheet in the same change.
  - Home currency is owner-only, so hide the picker for editors.
  - MV totals are per trip in that trip's home currency (the MV has no currency column); read it from the trip row.
- duplicate_trip copies currency and place arrival fields, but NOT expenses.
- mutations.ts validates values and throws SyncWriteError('invalid_value'), because server-rejected writes would otherwise retry forever.
- export-account never exported trip_expenses → Y1.2's call.

## Security (827bc5b) constraints for every new function/table
- requireUser from _shared/auth.ts. Quotas via consume_usage_quota (0032) / service_usage (0037).
- No anon/PUBLIC execute. Global default privileges revoke PUBLIC, so grant explicitly.
- Share links are owner-only. The public share read drops trip id and place notes (contractVersion 2); a "show notes" toggle would be v3 via public-fields.ts.
- CSP in public/_headers + functions/share/[token].ts: any new external origin (Overpass is server-side, fine; Wikipedia images → img-src https: already ok) must be added to BOTH.

## UI follow-ups carried
- Viewers still see the "Add places to optimize" pill (TripHeader doesn't know the role).
- Invite quota errors still redden the email field.
- COPY consts in index.tsx/add.tsx/TripHubTab/TripHeader/TripSettingsSheet/ShareLinkCard/InviteSheet/AccommodationEditSheet need extraction to i18n (Y4.2/4.3).

## From Y1.2 (0036 memories, 0037 sharing/prefs/poi)
- Column: visibility text default 'only_me' ('only_me'|'trip'). The author sees all of their own items (incl. deleted). Others see only items with visibility='trip', deleted=false, and for photos status='ready'.
- Any member (incl. viewer) can create their OWN memories. Only the author can edit, and only while still a member.
- Owner moderation: RPC remove_trip_memory(p_kind,p_id). It works only on shared items. For photos, delete the files first, then call the RPC.
- Photo flow: insert the row → upload both files to the RETURNED paths (409 on retry = already there) → set status='ready'.
  - Server-owned columns: updated_at, status, bytes, thumb_bytes, storage_path, thumb_path.
  - Rows still pending after 24h are purged hourly.
- Review: a second live review for the same place auto-retires the older one. Journal: many entries per day; text may be empty.
- Errors come as the PostgREST message token (quota ones carry details {scope,limit,used}): quota_exceeded, storage_full, upload_incomplete, not_author, immutable_column, author_mismatch, not_found.
- Quota for the Profile screen: rpc('get_memory_quota',{p_trip_id}).
- MUST (Y2.1): Tier-1 memory roots are scoped to author_id = auth.uid() (own items only). Other members' shared items are read via TanStack Query (Tier-2), NOT persisted, because an un-share would otherwise leave ghost rows.
- share-trip (Y2.5): filter visibility='trip' AND deleted=false (+ status='ready' for photos) AND the trip toggle show_memories. Toggle defaults: itinerary on, expenses off, memories off.
- Y1.3 contract:
  - consume_service_usage(p_service,p_units,p_cap) and consume_poi_quota(p_user,p_units,p_cap) are service-role only.
  - poi_cache(key, payload ≤ 256 KiB, fetched_at), 30-day TTL. A payload over 256 KiB fails with 23514 → don't cache.
- AccountExport type (types.ts) needs optional trip_journal_entries, trip_place_reviews, trip_photos, user_preferences.
- The export still lacks expenses/stays/comments (pre-existing gap) → Y4.4 or a follow-up.
- Deno tests run via: MSYS_NO_PATHCONV=1 docker run --rm -v "C:/Users/hemre/Desktop/Tripvisor/supabase:/app/supabase:ro" -w /app denoland/deno:alpine-2.1.4 test --allow-env --allow-net=127.0.0.1 <files>

## From Y1.4 (i18n) — how every UI agent adds strings
1. Import and hook:
   - `import { useT, formatMoney, formatDate } from '@/i18n'`, then `const { t: tx } = useT(['myns','common'])`.
   - Use `tx` because the theme already owns `t`.
   - List every namespace you use, so `tx('common:actions.cancel')` type-checks.
2. Add keys to BOTH `src/i18n/locales/en/<ns>.json` and `tr/<ns>.json`, only in your own namespace. Empty files already exist for trip, place, memories, money, routes, discover, share, recap, ai, collab, stays, packing, home, today and insights.
   - Plurals: `key_one`/`key_other` with `{ count }`.
   - Interpolation: `{{var}}`, never `+`.
   - Rich text: `<Trans t={tx} i18nKey components />`.
3. Keys are literals or have a literal prefix. Keep error KEYS in state, not translated strings.
4. Never call `toLocale*`/`new Intl.*`. Use `formatMoney(amount, row.currency)` (the ISO code is required), `formatDate(d,'medium')`, `formatDateRange`, `formatRelative`, `formatNumber`, `formatPercent`, `formatDuration`, `formatDistance`, `compareText`, `toLocaleUpper`.
5. Add extracted paths to `MIGRATED` in `scripts/i18n-check.js` and run `npm run i18n:check`.
   - Tests default to English. Assert via `i18n.t('ns:key')`; switch with `await act(() => setLanguagePreference('tr'))`, then reset to 'system'.
- Backend: Y2.5 uses `appLanguage()` for `lang`. Y3.4 uses `useLanguagePreference()`/`setLanguagePreference()`.
- SSR/static export renders EN; the client switches to the visitor's language (hydration mismatch is recoverable).
- API changes: `LegalLinks` takes `variant` (was `prefix`); `ONBOARDING_CARDS` = `{key, art}`; `LEGAL_UPDATED` is ISO.
- Legal TR is a faithful translation; KVKK not mentioned → user/lawyer review.

## From Y1.3 (fx-rates, poi-recommend)
- fx-rates (contractVersion 1):
  - Request: POST/GET {action rates|currencies, date latest|YYYY-MM-DD, base|from, quotes[]|to}.
  - Client `src/api/fx.ts`: fetchFxRate(from,to,date), useFxRate/useFxRates/useFxCurrencies, FxError, isPermanentFxError, fxKeys root 'fx' (not in the persister).
  - Y2.2: expense fx_rate = fetchFxRate(expense.currency, trip.currency, date).rate. On rates_unavailable/quota_* → save fx_rate=null ("rate pending") and reconcile later.
  - fx_rates.source may carry the publication date: 'frankfurter-ecb@2026-09-25'.
  - 166 codes supported (ECB ~30 + Frankfurter blend). Per-user fill cap is 60/day; cache hits are free.
- poi-recommend (contractVersion 1):
  - Request: POST {lat,lng,radiusM 100–5000 (default 1500), interests[1..8] from history|food|nature|museums|nightlife|shopping|kids|viewpoints, lang, limit ≤ 30, enrich}.
  - Returns items[] {id, source osm|wikipedia, osm{type,id}, name, originalName, lat, lng, distanceM, interests, kind, tags, wikidata, wiki{lang,title,extract,description,thumbUrl,url}, score}, plus attribution{osm,osmUrl,wikipedia,wikipediaUrl} and degraded.
  - Client `src/api/recommendations.ts`: useRecommendations, fetchRecommendations, INTERESTS, RecommendationsError, recommendationKeys (memory-only).
  - UI MUST show attribution.osm with its link, and the CC BY-SA + article link on wiki cards.
  - The first search takes 4–8 s (Overpass is slow and sometimes 504s) → show a skeleton plus a "searching nearby…" state. The degraded 'overpass_unavailable' fallback returns Wikipedia GeoSearch results.
  - Kill switch: app_config recommendations=off|cache_only. Per-user 40 searches/day (cache hits free).
- NO Google `resolve` in poi-recommend. "Add to trip" from a POI card should use the existing quota-metered places-autocomplete (card name + location bias) → pick the first match → create the trip place.

## !! CORRECTION (Wave-1 review #4) — supersedes Y1.1 conversion rule 4
Money conversion order (MV + Y2.2 lib):
1. Rate is 1 when the expense currency = current home.
2. Else use the frozen fx_rate ONLY IF fx_home_currency = current home.
3. Else recompute from fx_rates on fx_date.
4. Else the row is **PENDING**: exclude it from converted totals and expose a pending count/amount per currency. NEVER multiply by a rate that converts into a different currency, and NEVER count pending 1:1.
- The home-currency-change flow (Y3.2) must warm fx-rates for every distinct fx_date of that trip's expenses.
- Fixed in migration 0038 (fix round).

## From the Wave-1 fix round (0038, applied locally and uncommitted at the time of writing)
- Photo quota is counted in BYTES (per author, from storage.objects) and enforced in both the row trigger and the Storage INSERT policy. Pending cap 20 (app_config memories_user_pending_cap); 100 MiB per author (memories_user_bytes_cap).
- Y2.1:
  - After tombstoning or deleting a photo, delete its 2 files.
  - Bounded upload concurrency; on quota_exceeded {scope:'pending'}, wait.
  - Error scopes: user_bytes, pending.
- Reviews: trip_place_id is nullable (ON DELETE SET NULL). place_name_snapshot/place_google_id_snapshot are read-only.
- get_my_trip_stats: new pending_count, pending_actual_by_currency, pending_estimated_by_currency. Totals exclude pending rows.
- TODO: a service-role Edge Function sweeping orphan trip-memories objects via trip_memories_sweep_candidates() plus a cron schedule.

## RESUME CHECKLIST (session ended at the usage limit, 2026-09-29)
1. (DONE) Wave-1 fix rounds and the dev-server OOM fix are committed (da12fb4, c5d8c46, 061adfd).
2. When they're done: run the gates (tsc, jest, i18n:check, sync:validate, supabase/tests/*.sql, Deno via docker), then commit, EXCLUDING supabase/config.toml (a temporary local port change to 553xx; revert with `git checkout supabase/config.toml` and set .env back to 54321 after `net stop winnat; net start winnat` as admin).
3. Next: M5 Wave 2 (Y2.1–Y2.5 in BUILD-LOG §M5), then Waves 3 and 4. Pass this file's contracts into each brief.
4. The user must do these before any web deploy or APK build:
   - Supabase "Confirm email" ON.
   - `npx supabase db push` (0031–0038).
   - Deploy the changed functions.
   - `supabase secrets set PHOTO_URL_SECRET=...`.
   - Fix the Google key (403 PERMISSION_DENIED).

## Functions fix round (done)
- export-account now covers expenses, stays, packing, documents, shares (no token) and collaborators (no invite_token), plus own comments/reactions. Paged in 1000s; id filters chunked by 100.
- fx past dates store ECB + requested codes only; per-user cap 20/day; quota/upstream failure returns 429/503, never 422.
- poi logs a geohash-4, never userId+coords. upstream.ts stream-caps the body.

## UI fix round (done)
- Prerendered screens (auth, legal, onboarding): read language via useT/useAppLocale; use useIsHydrating for any browser-only value during render. The Y1.4 note "hydration mismatch is recoverable" is WRONG and superseded.
- API: pillForOptimizeError returns {tone,labelKey}; deleteTripErrorKey; inviteError returns {key,field}; TripHeader requires canEdit.
- The privacy policy promises EXIF/GPS stripping, so Y2.1 MUST re-encode photos and never upload the original.
- Minor: "TRİPVİSOR" shows under lang=tr because of CSS uppercase.

## Wave 2 file-ownership rules (orchestrator, 2026-09-29)
- New types go in NEW per-feature files (src/api/memories.types.ts, src/lib/money/types.ts, …). Do NOT edit src/api/types.ts in Wave 2 except where a step explicitly owns a block; re-read it before editing and re-grep afterwards.
- Only Y2.1 edits src/sync/** (allowlist/hydrate/mutations) for the memory roots. user_preferences stays Tier-2 (TanStack), owned by Y2.2.
- Orphan trip-memories sweep function + cron → Y2.1.
- Dev server: NetInfo HEAD probes are answered by metro.config.js; start it with BROWSER=none NODE_OPTIONS=--max-old-space-size=4096 npx expo start --web --port 8081.

## From Y2.3 (per-leg routing) — contract for Y3.3
- optimize-trip meta.contractVersion 2. Additive fields: keptOrderDays:number[], legSources{ors,google,estimate,user}.
- trip_legs:
  - day_index >= 0 → one row per consecutive pair. transport_mode is the effective mode (incl. flight/ferry).
  - polyline is null for transit (use transit_steps), estimate and user legs → draw a straight/arc dashed line.
  - day_index = -1 rows are matrix cache: NEVER render them.
- Helpers in @/api/routes: effectiveLegMode, isEstimatedLeg (show "≈"), isUserTimedLeg, isKeptOrderLegMode, isDayLeg, dayLegsFor, keptOrderDaySet, orderLegsForHopLookup, OPTIMIZE_CONTRACT_VERSION.
- UI rules:
  - No leg chip before a day's first stop.
  - Clear arrival_mode and arrival_minutes together.
  - After a mode change, run useOptimizeTrip with trip.route_render_mode.
  - Offer flight/ferry only on scheduled stops.
- computeDayTimeline ignores source → Y3.3 adds "≈" at render time.
- Estimate model (legs.ts): flight 800 km/h + 2 h; ferry 25 km/h; transit ×1.3 @25 km/h + 5 min; drive 40, walk 4.8, bike 15 km/h ×1.3. (BUILD-LOG says flight 700 km/h + 90 min, ferry 30 km/h → docs to align.)
- Deploy: 0035 before optimize-trip. Deploy directions-polyline + distance-matrix together with it (perLeg, provider, noRoute).
- Deno for fns that call Deno.serve at load: `--allow-net=127.0.0.1,0.0.0.0:8000`, one file per run, plus `-v .../src/lib/optimizer:/app/src/lib/optimizer:ro` for optimize-trip.

## From Y2.5 (sharing, lang, recommendations client) — contracts for Y3.4/Y3.5
- share-trip ops (owner only):
  - create {tripId, settings?} → {token, createdAt, settings}.
  - current {tripId} → {share|null}.
  - update_settings {tripId, token?, settings}; with no active link → 404 no_active_link.
- Public read, contractVersion 3:
  - sections{itinerary,expenses,memories} is always present.
  - expenses = summary only (homeCurrency, count, totals, byCategory, pending, byCurrency).
  - memories = {journal, reviews, photos, photoUrlExpiresAt, truncated}. Photos are 1 h signed URLs. No author ids.
- Client:
  - Sharing: useCurrentShareLink / useTripShareSettings(tripId,{enabled:isOwner}); useUpdateShareSettings (optimistic); useCreateShareLink().mutate({settings}); DEFAULT_SHARE_SETTINGS; ShareLinkError; useSharedTrip → SharedTripPayload.
  - Language: `lang` is sent on places / details / AI / poi (appLanguage()), and place query keys include lang.
  - Recommendations:
    - useRecommendations({tripId, dayIndex?, center?, interests, lang?}); useRecommendationCenter.
    - useAddPoiToTrip(tripId).mutate({poi, dayIndex?, existingGooglePlaceIds?, match?}) → {place, googlePlaceId, matchedName, scheduled}.
    - resolvePoiGooglePlace(poi,{sessionToken}): pass its result as `match` → 1 metered search.
    - AddPoiError.code: no_match | quota_exceeded | places_unavailable | not_authenticated | already_in_trip | create_failed | invalid_input. There is NO custom-place fallback (google_place_id NOT NULL).
    - scheduled===false → "Added to Ideas".
- Y3.5 UI:
  - Mount the owner hooks with {enabled:isOwner}; re-show the token after reload; handle no_active_link.
  - Render each public section only if its key is present; itinerary off → "hidden by owner".
- ORCHESTRATOR DECISION (2026-09-29, privacy): the public link shows ONLY memories AUTHORED BY THE TRIP OWNER (visibility='trip'), never other members' items. They consented to share with the trip, not the internet. Fix in the Wave-2 gate round (share-trip filter + test + toggle copy "publishes your shared memories").
- Gate-round follow-ups:
  - A per-IP rate limit on anonymous share reads (signing up to 200 objects per read; Storage egress).
  - `_shared/ai.ts` grounding should pass languageCode (AI place names are English today).
- Deno for fns that call Deno.serve at load: --allow-net=127.0.0.1,0.0.0.0:8000.

## From Y2.4 (visual foundation)
- Tokens:
  - `layout` scale (formWidth 640, contentWidth 960) and `elevation` scale.
  - `surfaceStyle(t, level)`.
  - heroScrim, heroScrimSoft, heroGlass.
  - The contrast test (`src/theme/__tests__/contrast.test.ts`) gates every pair.
- ONE day-colour source, `src/theme/dayColors.ts`: dayColor, dayTint, DAY_COLORS, DAY_NEUTRAL, ON_DAY_COLOR, withAlpha. Memories timeline (Y3.1) MUST use it.
- New components:
  - `Screen width="form"|"content"|"full"` + ScreenScrollView.
  - TripHero, TripCover, TripStatusChip (Relive / Day N of M / In N days), heroCollapse.
  - PlaceThumb: memory photo → category tile. ROW_GOOGLE_PHOTOS=false (orchestrator: attribution + quota).
- Orchestrator visual review (2026-09-29) → Wave-2 gate / Y4 fixes:
  - The brand overline shows "TRİPVİSOR" in tr (CSS uppercase) → write "TRIPVISOR" literally / no textTransform.
  - Day chips "D1 Thu 18" are English in tr → dayChips.ts via the i18n formatters (Y3.3 or Y4).
  - The phone header chip row truncates the route-limit pill ("Rota hızn…") → wrap or icon-only.
  - Legacy English strings in tr: "Your trips", "Starts", "Travel", "Add notes…", "places/Visit/Day" chips → Y4.2/4.3.
- Screenshots: %TEMP%\tripvisor-y24-shots\

## From Y2.1 (memories data layer) — hook contracts for Y3.1 (all from @/api/memories; types in memories.types.ts)
- Read:
  - useTripMemories(tripId) → {data?{days[{dayIndex|null, items}], items, counts{photos, journal, reviews, uploading, failed}, latestPhoto}, userId, isLoading, error, isRefetching, refetch}.
  - MemoryItem {id, tripId, dayIndex, at, isOwn, visibility} plus photo{photo, upload} | journal{entry} | review{review}. Undated items come last; own items still show offline.
- Journal:
  - useJournalEntry(tripId, dayIndex) → {data, entries, isLoading}.
  - useSaveJournalEntry() {tripId, dayIndex, body, visibility?, id?} → id.
- Reviews:
  - usePlaceReviews(tripId, tripPlaceId) → {mine, others}.
  - useUpsertPlaceReview() {tripId, tripPlaceId, rating 1–5|null, body?, visibility?}.
- Photos:
  - useAddPhotos() {tripId, assets: PickedPhoto[], dayIndex? (undefined = derive from capture date, null = undated), tripPlaceId?, caption?, visibility?} → {ids, failed}. Works offline.
  - usePhotoUploads(tripId?) → {jobs[{state queued|uploading|waiting|failed, progress, waitingFor, error, previewUri}], retry, cancel, durable}.
  - useUpdatePhoto() {id, tripId, caption?, dayIndex?, takenAt?, tripPlaceId? (online only)}.
  - useMemoryPhotoUrls(paths) / useMemoryPhotoUrl(path): thumb_path for grids, storage_path for the lightbox; 1 h signed URLs.
- All kinds:
  - useSetMemoryVisibility() {tripId, items[{kind,id}], visibility} (bulk OK).
  - useDeleteMemory() {tripId, kind, id}: tombstone + undo.
  - useRemoveTripMemory() (owner moderation).
  - useMemoryQuota(tripId?).
- MemoryError {code, scope?, limit?, used?}. Codes: quota_exceeded (user|user_bytes|pending|trip), storage_full, unsupported_image, image_too_large, exif_strip_failed, not_authenticated, forbidden, network → i18n keys.
- UI MUST:
  - `npx expo install expo-image-picker` + app.json permission strings; pass result.assets straight to useAddPhotos.
  - NEW native build required: expo-image-manipulator (and picker) are native modules.
- Cloud (user):
  - db push (0031–0039).
  - Deploy memories-sweep.
  - `secrets set MEMORIES_SWEEP_SECRET`.
  - Vault secrets project_url / anon_key / memories_sweep_secret.
  - Verify with `select public.invoke_memories_sweep();`.
- Risks:
  - Tombstoned photos keep their files if the device never comes back online (follow-up: a server sweep of old tombstones).
  - Very long journals are a risk on web (1 MiB per-table cap).
  - Native EXIF/orientation needs a device check.

## From Y2.2 (money + preferences) — contracts for Y3.2/Y3.4
- @/lib/money:
  - Pure bigint decimals: MoneyValue {currency, exact, value}; pass `value` to formatMoney(value, currency).
  - parseAmount(text, {language, currency}).
  - planHomeCurrencyChange(rows, oldHome, newHome).
- @/api/trip-expenses:
  - useTripMoneySummary(tripId, {rateMode 'entry'|'today', autoWarm}) → {data {total, byCategory, byDay, byCurrency (home first; original / converted / pending), pending {count, ids, actualByCurrency, estimatedByCurrency}, budget, remaining, rows, counts, methods}, home, isFetchingRates, ratesError, todayRatesUnavailable}.
  - useWarmFxForTrip(tripId).mutate({homeCurrency}) → call after useUpdateTrip({currency}).
  - useTripExpenseRollup: same shape as before, plus currency / pendingCount / pending*ByCurrency.
  - Create: optional currency/fx_*. The rate is resolved automatically (cache → fetch in 4 s → pending); works offline.
- @/api/expense-fx:
  - useExpenseFxPreview({amount, currency, home, tripStartDate, dayIndex}) → live "≈ ₺…".
  - useMoneySummaries(trips, expenses) for analytics.
  - The reconciler auto-starts (owner/editor only).
- @/api/preferences:
  - useUserPreferences() → {locale, home_currency, interests[], saved}; useUpdateUserPreferences() (partial, optimistic).
  - useLanguagePreferenceMirror(): mount once in the signed-in tree.
- Y3.2 TODO:
  - analytics.tsx still sums raw amounts → switch to useMoneySummaries.
  - createTripSchema (trips.ts) lacks currency → add when flipping TripCurrency, and prefill from preferences.
