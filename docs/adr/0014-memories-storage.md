# ADR-0014: Memories — client-compressed photos in a private `trip-memories` bucket, Tier-1 journal and reviews

**Status**: Accepted (planned in Phase M5, steps Y1.2 / Y2.1 / Y3.1)
**Date**: 2026-09-29

## Context

Tripvisor becomes an after-trip memory and review app as well: photos, a journal entry per day, and a personal 1–5 rating plus review per place. The Supabase free tier gives **1 GB of Storage** and about 5 GB of egress per month, shared by *all* users. Image transformations are a paid-plan feature. There is already a proven pattern for this: a private `trip-docs` bucket (0024) with `<trip_id>/…` path-prefix RLS. The user wants memories to be private by default, visible to trip members, and optionally included in the public share link, with a per-trip toggle.

## Decision

1. **Photos:**
   - Compress on the client with `expo-image-manipulator` (it uses canvas on web). The full image is resized to a 1600 px long edge and re-encoded as JPEG, stepping quality down from 0.75 until it's ≤ 350 KB (target ~300 KB). A **thumbnail** (400 px, ~40 KB) is generated in the same pass. Re-encoding strips EXIF, so GPS never leaves the device. Only `taken_at` is kept.
   - Photos are picked with `expo-image-picker` (camera and library on native, file input on web).
   - Storage: a **new private bucket `trip-memories`** (1 MB object limit, `image/jpeg`/`image/webp`), not `trip-docs`, because its limits, MIME types, quotas and lifecycle are different. Paths are `<trip_id>/<author_id>/<photo_id>.jpg` and `…_t.jpg`.
   - A `trip_photos` row (`trip_id, author_id, day_index?, trip_place_id?, storage_path, thumb_path, width, height, bytes, caption, taken_at, only_me, deleted`) is the index for each photo. The storage read policy joins this row (trip access, and `only_me = false` or the reader is the author).
   - Clients display photos through signed URLs (1 h TTL), cached in memory only. Grids load thumbnails only, and the full image loads on open.
2. **Quotas (1 GB is global):** a trigger on `trip_photos` enforces per-user (default 300) and per-trip (default 500) caps from `app_config`, plus a **global guard** that refuses new rows once `trip-memories` passes 900 MB, returning a clear "storage full" error code. Profile shows each user's usage.
3. **Journal and reviews:** `trip_journal_entries` (per day, per author) and `trip_place_reviews` (rating 1–5 + body, unique per place and author among non-deleted rows) become **Tier-1 write-enabled roots**, so people can journal offline during the trip. They follow the 0027 conventions (tombstones, `updated_at` trigger, realtime publication).
   - Photo metadata is a Tier-1 **read** root. On native, uploads go through a small persisted retry queue that holds the local file URI. On web, uploads need a connection.
4. **Visibility:** any trip member (viewer and up) can add their *own* memories. Only the author can edit an item; the author or the owner can delete it. By default a memory is visible to trip members. The per-item **"Only me"** flag makes it private to the author. The public link shows memories only when `trip_shares.show_memories` is on, and **never** shows `only_me` items. It uses short-lived signed URLs minted by `share-trip`.
5. **ToS:** memories and reviews are user content, so they can be stored. They are shown separately from Google reviews ("Your review" vs "Reviews from Google" with Google's attribution), and never mixed into the same list or averaged with Google ratings.

## Alternatives considered

- **Reuse `trip-docs`:** it mixes limits and lifecycles, and its 10 MB cap invites uncompressed photos.
- **Cloudflare R2** (10 GB free): needs a payment method on file plus a second auth and signing path. It's the documented escape hatch if 1 GB proves too small.
- **Supabase image transformations:** paid plan only. **Cloudinary free:** a third-party account plus credit limits.
- **Device-only photos:** no sharing with trip members or on the public link, and photos are lost with the device.

## Consequences

- About 2,900 photos fit across all users. The caps and the global guard make running out a clear error, not silent failure. This is a known scaling ceiling, recorded in the debt register.
- The client deletes the storage objects of a tombstoned photo when online. Account deletion extends to the new bucket (`delete-account`), and export covers the new tables (`export-account`, metadata only).
