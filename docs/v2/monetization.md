# Tripvisor — Monetization Plan (future, post-GA)

> **Status:** Planned 2026-06-11 (user direction: "I will add ad or subs system in future for revenue").
> Not built yet — this doc fixes the model, the architecture seam, and the phases so nothing we ship before then fights it.

## Recommendation: subscriptions-first freemium; ads optional and only on the free tier later

**Why subs over ads as the primary:**
- Tripvisor sells a *premium travel-planning feel* (a stated product priority) — banner ads directly undercut it.
- Ads need AdMob = a **new native module** (expo plugin + EAS builds + iOS ATT/consent UX + GDPR consent flow) for cents per user at hobby scale. Subs monetize the users who already love the product.
- **The pricing lever already exists**: the C4 per-user AI quota (`ai_usage`, server-enforced). Free = 10 AI plans/day; Pro = more. Zero rework — this was an accidental gift of the quota design.

**Ads, if ever:** AdMob banner on the trips list for free-tier users only, behind an `app_config` kill-switch, never inside the planning flow. Treat as an experiment, not a pillar.

## The free-tier-compatible stack ($0 until revenue)

| Piece | Tool | Cost |
|---|---|---|
| Native IAP (iOS + Android) | **RevenueCat** (handles receipts, restore, cross-platform entitlements) | free to $2.5k MTR |
| Web payments | **Stripe Checkout** (web is exempt from store IAP rules) | per-transaction only |
| Entitlement sync | 2 webhook Edge Functions (`revenuecat-webhook`, `stripe-webhook`) → `user_entitlements` | $0 (Supabase free) |
| Store compliance | Digital subs **must** use IAP on native (Apple/Google take 15–30%); web Stripe is allowed; never link native → web checkout (Apple rule) | — |

## Architecture (the seam to respect from today)

```
purchase (RevenueCat / Stripe) ──webhook──► Edge Fn ──► user_entitlements (plan, expires_at, source)
                                                              │
                 client useEntitlements() ◄── RLS read ───────┤
                 server Edge Fns (quota, limits) ◄── service read (AUTHORITATIVE)
```

- **`user_entitlements`** table: `user_id pk`, `plan ('free'|'pro')`, `source ('revenuecat'|'stripe'|'admin')`, `expires_at`, `updated_at`. RLS: SELECT own row; writes only via webhook Edge Fns (service role). Absent row = free.
- **Enforcement is server-side** — quota checks in `ai-itinerary`/`ai-edit` read the plan and pick the limit (free 10/day → pro e.g. 100/day; grounding 100 → 1000). The client `useEntitlements()` hook only *shows* state (badges, paywall), never grants it. This rule is already true for quotas today ✓.
- **Pro levers (candidates):** higher AI quota · unlimited document storage (free capped ~50MB) · offline trip packs (post-S2) · priority routing (Google instead of ORS) · more collaborators per trip. Core loop stays free forever (choose places → reviews/comments → adjust route) — monetize *depth*, never the loop.

## Rules that protect us until then (already satisfied — keep them)

1. All limits enforced in Edge Functions, never client-only ✓ (C4 quota design)
2. No feature hard-wired to "always free" copy in UI strings — keep limits in one place ✓ (`ai_usage` + Edge Fn constants)
3. `app_config` exists for kill-switches/experiments ✓
4. Auth identity is stable (Supabase user id) — entitlements key off it ✓

## Phases (slot after P5 launch; M2 needs the native track done)

- **M1 — Entitlements foundation** (backend, ~1 wave): `user_entitlements` migration + `useEntitlements()` + plan-aware quota constants in ai-* functions + a simple Pro badge/paywall screen (UI shell, no payments yet; admin-granted Pro for testing).
- **M2 — Payments**: RevenueCat SDK (native; needs an EAS build — pairs with P4/native GA) + Stripe Checkout (web) + the two webhook Edge Fns + restore-purchases UX + paywall wired.
- **M3 (optional) — Free-tier ads experiment**: AdMob banner, trips list only, consent flow, `app_config` kill-switch, measure retention impact before keeping.

**Pre-work cost now: zero.** The architecture is already monetization-ready; this doc just locks the seam.

See also: [`tech-stack.md`](tech-stack.md) · [`../../plan-v2.md`](../../plan-v2.md) · [`BUILD-LOG.md`](BUILD-LOG.md)
