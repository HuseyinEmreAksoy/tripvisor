# ADR-0013: Interest-based recommendations — OSM (Overpass) + Wikipedia/Wikidata candidates, Google only on tap

**Status**: Accepted (planned in Phase M5, steps Y1.3 / Y2.5 / Y3.4)
**Date**: 2026-09-29

## Context

Users pick interests (history, food, nature, art/museums, nightlife, shopping, kids, viewpoints) and expect matching places near their trip. Google Nearby Search would work, but every call spends metered credit, and the ToS forbids persisting the results. The product must stay at $0. OpenStreetMap data is free (ODbL, attribution required) and can be cached. Wikipedia and Wikidata add free descriptions and images (CC BY-SA, attribution required). The public Overpass instances ask for roughly ≤10k requests and ≤1 GB per day, and discourage production apps from leaning on them without care (https://dev.overpass-api.de/overpass-doc/en/preface/commons.html, checked 2026-09-29).

## Decision

1. **`poi-recommend` Edge Function** (new, `meta.contractVersion: 1`) with two actions:
   - `search {lat, lng, radiusM ≤ 5000, interests[], lang}` → up to 30 candidates `{osmId, name (lang-aware name:tr/name:en), lat, lng, interest, kind, wikidata?, wiki?: {title, extract, thumbUrl, url}}`.
   - `resolve {name, lat, lng}` → a `google_place_id`, via Places Text Search (New) with the field mask `places.id,places.location`, location-biased, and accepted only within 300 m. This is the IDs-only SKU (verify current free status in the console). The client then adds the place through the existing add path, and the Google rating and reviews show only on tap through the existing Tier-2 `place-details` path. **Nothing from Google is stored.**
2. **Interest → OSM tag map** lives in `supabase/functions/_shared/interests.ts`:
   - history: `historic~castle|monument|ruins|archaeological_site|fort|memorial|city_gate|palace`, `tourism=museum`+`museum=history`
   - food: `amenity~restaurant|cafe|food_court|ice_cream`, `amenity=marketplace`
   - nature: `leisure~park|garden|nature_reserve`, `natural~beach|peak|waterfall|cave_entrance`, `boundary=national_park`
   - art/museums: `tourism~museum|gallery|artwork`, `amenity~theatre|arts_centre`
   - nightlife: `amenity~bar|pub|nightclub|biergarten`
   - shopping: `shop~mall|department_store|gift|craft`, `amenity=marketplace`
   - kids: `tourism~zoo|aquarium|theme_park`, `leisure~playground|water_park`
   - viewpoints: `tourism=viewpoint`, `man_made=tower`+`tower:type=observation`

   Only named features are returned. Ranking: has `wikidata`/`wikipedia` (a proxy for notability) > distance > tag weight.
3. **Caching and fair use:**
   - The `poi_cache(key, payload jsonb, fetched_at)` table caches one Overpass query per **geohash-5 tile (~5 km) × interest**, and each Wikipedia summary per `wikidata × lang`, both for 30 days. Payloads are trimmed to the fields above.
   - Upstream Overpass calls are capped globally at 2,000 a day through a `service_usage(service, day, count)` counter.
   - Each user is capped at 40 searches a day through `ai_usage.poi_requests`.
   - Failover order: primary Overpass → secondary instance (`OVERPASS_URLS` env list) → **Wikipedia GeoSearch only** (notable articles with coordinates). The `app_config` row `recommendations='off'` is a kill switch.
   - Requests send a descriptive `User-Agent` (Wikimedia policy).
4. **Attribution:** every result list shows "© OpenStreetMap contributors". Wikipedia text and images link to their source with a CC BY-SA note.

## Alternatives considered

- **Google Nearby Search as the candidate source:** metered, can't be persisted or cached, and interest-to-type mapping is coarser. Rejected on cost and ToS grounds.
- **Foursquare / Yelp free tiers:** keys, attribution-heavy terms, and weak coverage in Türkiye. **Self-hosted Overpass:** $0 is not realistic at planet scale.
- **AI (Gemini) suggestions:** already exists as gap-fill, but it hallucinates and each result needs grounding. OSM gives real coordinates for free.

## Consequences

- Recommendations work without Google until the user shows intent (a tap to see details, or adding the place). A place with no confident Google match can't be added in M5; this is logged as debt, and the card shows "couldn't match to a map place".
- Cache hit rates grow with usage. The worst case (many new cities a day) is bounded by the global cap, after which the Wikipedia-only fallback applies.
