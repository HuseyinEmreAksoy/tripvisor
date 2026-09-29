# Architecture Decision Records

Most recent first.

- [ADR-0014](0014-memories-storage.md) — Memories: client-compressed photos (~300 KB + thumb) in private `trip-memories` bucket, quotas + 900 MB global guard, Tier-1 journal/reviews, only-me flag — Accepted — 2026-09-29
- [ADR-0013](0013-recommendations-osm-wikipedia.md) — Recommendations: OSM Overpass + Wikipedia/Wikidata via `poi-recommend` with tile cache + caps; Google only on tap / IDs-only resolve — Accepted — 2026-09-29
- [ADR-0012](0012-fx-frankfurter-cached-rates.md) — Multi-currency: Frankfurter via `fx-rates` Edge Fn, `fx_rates` daily cache, rate frozen per expense — Accepted — 2026-09-29
- [ADR-0011](0011-i18n-i18next-expo-localization.md) — i18n: i18next + react-i18next + expo-localization, bundled per-feature namespaces, Intl formatting by app locale — Accepted — 2026-09-29
- ADR-0006 … ADR-0010 — see files in this folder (not indexed here)

- [ADR-0005](0005-offline-cache-policy.md) — Offline cache policy: 7-day maxAge, allowlist-only persistence, Google ToS keys excluded — Accepted — 2026-04-24
- [ADR-0004](0004-ics-timezone-policy.md) — .ics timezone policy: emit DTSTART;TZID=<IANA zone> + VTIMEZONE block, fall back to UTC absolute — Accepted — 2026-04-24
- [ADR-0003](0003-sentry-init.md) — Sentry init: @sentry/react-native, DSN env-guarded, tracesSampleRate 0.1, no PII — Accepted — 2026-04-24
- [ADR-0002](0002-share-link-shape.md) — Share-link route shape: /share/[token] standalone route, not /trip/[id]?token= — Accepted — 2026-04-24
- [ADR-0001](0001-kmeans-2opt-over-or-tools.md) — k-means + 2-opt over OR-tools/VRP solvers for the trip optimizer — Accepted — 2026-04-23
