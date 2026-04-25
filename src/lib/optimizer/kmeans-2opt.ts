/**
 * Pure route optimizer for Tripvisor.
 * k-means clusters → per-day 2-opt with optional anchor pinning.
 *
 * Designed to be imported by:
 *   - Supabase Edge Function `optimize-trip` (Deno)
 *   - React Native client (for optimistic preview)
 *
 * No I/O, no globals, no Date.now() — deterministic for a given input + seed.
 */

export interface OptimizerPlace {
  id: string;
  lat: number;
  lng: number;
  visitMinutes: number;
}

export interface OptimizerLeg {
  fromId: string;
  toId: string;
  durationSeconds: number;
}

export interface OptimizerDay {
  dayIndex: number;
  orderedPlaceIds: string[];
  totalMinutes: number;
}

export interface OptimizerInput {
  places: OptimizerPlace[];
  /** Full N×N travel matrix. Missing pairs treated as `fallbackSeconds`. */
  legs: OptimizerLeg[];
  dailyBudgetMinutes: number;
  /** If set, optimizer starts day 0 from this place (it becomes first in its cluster). */
  anchorPlaceId?: string;
  /** Per-day start/end pins (e.g. hotel). Keyed by dayIndex. */
  dayStartEnd?: Record<number, { startId?: string; endId?: string }>;
  /** Used when a pairwise leg is missing. Default = Haversine-based estimate. */
  fallbackSecondsPerMeter?: number;
  /** Deterministic seed for the 2-opt random restarts. */
  seed?: number;
}

export interface OptimizerOutput {
  days: OptimizerDay[];
  /** A stable hash of (places, legs, budget, anchors) — use for idempotence checks. */
  stateHash: string;
}

// -------------------- public entry point --------------------

export function optimize(input: OptimizerInput): OptimizerOutput {
  const {
    places,
    legs,
    dailyBudgetMinutes,
    anchorPlaceId,
    dayStartEnd = {},
    fallbackSecondsPerMeter = 0.12, // ~30 km/h default driving
    seed = 1,
  } = input;

  if (places.length === 0) {
    return { days: [], stateHash: computeStateHash(input) };
  }

  const travel = buildTravelMatrix(places, legs, fallbackSecondsPerMeter);

  const totalVisitMinutes = places.reduce((s, p) => s + p.visitMinutes, 0);
  const k = Math.max(1, Math.ceil(totalVisitMinutes / dailyBudgetMinutes));

  const clusters = kmeansFarthestPoint(places, Math.min(k, places.length), anchorPlaceId, seed);

  const balanced = rebalanceByBudget(
    clusters,
    places,
    travel,
    dailyBudgetMinutes,
  );

  const days: OptimizerDay[] = balanced.map((cluster, dayIndex) => {
    const pin = dayStartEnd[dayIndex] ?? {};
    // Anchor pinning invariant: if the anchor lands in THIS day's cluster, it
    // must be pinned as the day's start — regardless of whether that day is
    // day 0. k-means with degenerate inputs (duplicate coords) can push the
    // anchor into a non-zero cluster; without this we'd silently lose the pin.
    // See ADR-0001 §Consequences.
    const anchorInCluster = anchorPlaceId && cluster.includes(anchorPlaceId)
      ? anchorPlaceId
      : undefined;
    const startId = pin.startId ?? anchorInCluster;
    const endId = pin.endId;
    const ordered = twoOpt(cluster, travel, {
      startId,
      endId,
      seed: seed + dayIndex,
      restarts: 3,
    });

    return {
      dayIndex,
      orderedPlaceIds: ordered,
      totalMinutes: dayTotalMinutes(ordered, places, travel),
    };
  });

  return { days, stateHash: computeStateHash(input) };
}

// -------------------- travel matrix --------------------

type TravelMatrix = Map<string, Map<string, number>>; // id -> id -> seconds

function buildTravelMatrix(
  places: OptimizerPlace[],
  legs: OptimizerLeg[],
  fallbackSecondsPerMeter: number,
): TravelMatrix {
  const byId = new Map(places.map((p) => [p.id, p]));
  const m: TravelMatrix = new Map();
  for (const p of places) m.set(p.id, new Map());

  for (const leg of legs) {
    const row = m.get(leg.fromId);
    if (row) row.set(leg.toId, leg.durationSeconds);
  }

  // Fill missing pairs with Haversine-derived fallbacks.
  for (const a of places) {
    const row = m.get(a.id)!;
    for (const b of places) {
      if (a.id === b.id) {
        row.set(b.id, 0);
      } else if (!row.has(b.id)) {
        const meters = haversineMeters(a.lat, a.lng, b.lat, b.lng);
        row.set(b.id, Math.round(meters * fallbackSecondsPerMeter));
      }
    }
  }

  // Symmetrize — Routes API can differ by direction, but for planning we collapse.
  for (const a of places) {
    for (const b of places) {
      if (a.id >= b.id) continue;
      const ab = m.get(a.id)!.get(b.id)!;
      const ba = m.get(b.id)!.get(a.id)!;
      const avg = Math.round((ab + ba) / 2);
      m.get(a.id)!.set(b.id, avg);
      m.get(b.id)!.set(a.id, avg);
    }
  }

  void byId;
  return m;
}

function travelSec(m: TravelMatrix, fromId: string, toId: string): number {
  return m.get(fromId)?.get(toId) ?? 0;
}

// -------------------- k-means with farthest-point seeding --------------------

function kmeansFarthestPoint(
  places: OptimizerPlace[],
  k: number,
  anchorId: string | undefined,
  seed: number,
): string[][] {
  if (places.length === 0) return [];
  if (k <= 1) return [places.map((p) => p.id)];

  const rand = mulberry32(seed);
  const byId = new Map(places.map((p) => [p.id, p]));

  const seeds: OptimizerPlace[] = [];
  const anchor = anchorId ? byId.get(anchorId) : undefined;
  seeds.push(anchor ?? places[Math.floor(rand() * places.length)]!);

  // Farthest-point sampling.
  while (seeds.length < k) {
    let bestIdx = -1;
    let bestDist = -Infinity;
    for (let i = 0; i < places.length; i++) {
      const p = places[i]!;
      if (seeds.some((s) => s.id === p.id)) continue;
      let dMin = Infinity;
      for (const s of seeds) {
        const d = haversineMeters(s.lat, s.lng, p.lat, p.lng);
        if (d < dMin) dMin = d;
      }
      if (dMin > bestDist) {
        bestDist = dMin;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    seeds.push(places[bestIdx]!);
  }

  let centers = seeds.map((s) => ({ lat: s.lat, lng: s.lng }));
  let assignment = new Array<number>(places.length).fill(0);

  for (let iter = 0; iter < 20; iter++) {
    let moved = 0;
    // Assign.
    for (let i = 0; i < places.length; i++) {
      const p = places[i]!;
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const ctr = centers[c]!;
        const d = haversineMeters(ctr.lat, ctr.lng, p.lat, p.lng);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assignment[i] !== best) moved++;
      assignment[i] = best;
    }

    // Recompute centers.
    const sums = centers.map(() => ({ lat: 0, lng: 0, n: 0 }));
    for (let i = 0; i < places.length; i++) {
      const p = places[i]!;
      const s = sums[assignment[i]!]!;
      s.lat += p.lat;
      s.lng += p.lng;
      s.n += 1;
    }
    centers = sums.map((s, idx) =>
      s.n > 0 ? { lat: s.lat / s.n, lng: s.lng / s.n } : centers[idx]!,
    );

    if (moved === 0) break;
  }

  // Return clusters as arrays of place IDs in input order per cluster.
  const clusters: string[][] = centers.map(() => []);
  for (let i = 0; i < places.length; i++) {
    clusters[assignment[i]!]!.push(places[i]!.id);
  }
  return clusters.filter((c) => c.length > 0);
}

// -------------------- budget rebalancing --------------------

function rebalanceByBudget(
  clusters: string[][],
  places: OptimizerPlace[],
  travel: TravelMatrix,
  dailyBudgetMinutes: number,
): string[][] {
  const byId = new Map(places.map((p) => [p.id, p]));
  const next = clusters.map((c) => [...c]);

  for (let pass = 0; pass < 8; pass++) {
    const totals = next.map((c) => clusterRoughMinutes(c, byId, travel));
    const overIdx = totals.findIndex((m) => m > dailyBudgetMinutes);
    if (overIdx < 0) break;

    const over = next[overIdx]!;
    if (over.length <= 1) break;

    // Find the cluster with the smallest total to receive.
    let targetIdx = -1;
    let targetMin = Infinity;
    for (let i = 0; i < next.length; i++) {
      if (i === overIdx) continue;
      if (totals[i]! < targetMin) {
        targetMin = totals[i]!;
        targetIdx = i;
      }
    }
    if (targetIdx < 0) break;

    // Move the place from `over` whose centroid-distance to target cluster is smallest.
    const target = next[targetIdx]!;
    const targetPlaces = target.map((id) => byId.get(id)!);
    const tc = centroid(targetPlaces);

    let moveId = over[0]!;
    let bestD = Infinity;
    for (const id of over) {
      const p = byId.get(id)!;
      const d = haversineMeters(p.lat, p.lng, tc.lat, tc.lng);
      if (d < bestD) {
        bestD = d;
        moveId = id;
      }
    }

    next[overIdx] = over.filter((id) => id !== moveId);
    next[targetIdx] = [...target, moveId];
  }

  return next.filter((c) => c.length > 0);
}

function clusterRoughMinutes(
  ids: string[],
  byId: Map<string, OptimizerPlace>,
  travel: TravelMatrix,
): number {
  let total = 0;
  for (const id of ids) total += byId.get(id)!.visitMinutes;
  // Rough pairwise traversal cost — upper bound proxy.
  for (let i = 1; i < ids.length; i++) {
    total += travelSec(travel, ids[i - 1]!, ids[i]!) / 60;
  }
  return total;
}

function centroid(places: OptimizerPlace[]): { lat: number; lng: number } {
  if (places.length === 0) return { lat: 0, lng: 0 };
  const lat = places.reduce((s, p) => s + p.lat, 0) / places.length;
  const lng = places.reduce((s, p) => s + p.lng, 0) / places.length;
  return { lat, lng };
}

// -------------------- 2-opt with anchor pinning --------------------

function twoOpt(
  ids: string[],
  travel: TravelMatrix,
  opts: { startId?: string; endId?: string; seed: number; restarts: number },
): string[] {
  // Short path: 1–2 places can't be meaningfully 2-opt'd, but we must still
  // honour start/end pins — otherwise a 2-place cluster containing the anchor
  // at index 1 would be returned [other, anchor], violating the invariant.
  if (ids.length <= 2) return pinEnds([...ids], opts.startId, opts.endId);

  const rand = mulberry32(opts.seed);
  let best: string[] = [];
  let bestCost = Infinity;

  for (let r = 0; r < opts.restarts; r++) {
    let order = [...ids];
    if (r > 0) shuffle(order, rand);
    order = pinEnds(order, opts.startId, opts.endId);

    let improved = true;
    while (improved) {
      improved = false;
      // Re-resolve pinned indices against the current `order` each pass.
      // `pinEnds` moves startId to position 0 and endId to the last index,
      // but we DON'T rely on those positions staying constant — we look them
      // up fresh. This generalises the anchor-exclusion rule: whatever index
      // the pinned place occupies, no 2-opt swap may cross it.
      const startIdx = opts.startId ? 1 : 0;
      const endIdx = opts.endId ? order.length - 1 : order.length;
      const pinnedStartPos = opts.startId ? order.indexOf(opts.startId) : -1;
      const pinnedEndPos = opts.endId ? order.indexOf(opts.endId) : -1;

      for (let i = startIdx; i < endIdx - 1; i++) {
        for (let j = i + 1; j < endIdx; j++) {
          if (j - i === 1) continue;
          // Option B (anchor-exclusion): a 2-opt reversal of positions [i..j]
          // mutates every index in that range. If a pinned place's current
          // index falls within [i..j], skip the swap — otherwise the reversal
          // would displace the pin. This is the anchor-at-any-index guard.
          if (pinnedStartPos >= 0 && pinnedStartPos >= i && pinnedStartPos <= j) {
            continue;
          }
          if (pinnedEndPos >= 0 && pinnedEndPos >= i && pinnedEndPos <= j) {
            continue;
          }
          const before = segmentCost(order, travel);
          const reversed = [
            ...order.slice(0, i),
            ...order.slice(i, j + 1).reverse(),
            ...order.slice(j + 1),
          ];
          const after = segmentCost(reversed, travel);
          if (after < before - 1) {
            order = reversed;
            improved = true;
          }
        }
      }
    }

    const cost = segmentCost(order, travel);
    if (cost < bestCost) {
      bestCost = cost;
      best = order;
    }
  }

  return best;
}

function pinEnds(order: string[], startId?: string, endId?: string): string[] {
  let out = [...order];
  if (startId && out.includes(startId)) {
    out = [startId, ...out.filter((id) => id !== startId)];
  }
  if (endId && out.includes(endId)) {
    out = [...out.filter((id) => id !== endId), endId];
  }
  return out;
}

function segmentCost(order: string[], travel: TravelMatrix): number {
  let total = 0;
  for (let i = 1; i < order.length; i++) {
    total += travelSec(travel, order[i - 1]!, order[i]!);
  }
  return total;
}

function dayTotalMinutes(
  ordered: string[],
  places: OptimizerPlace[],
  travel: TravelMatrix,
): number {
  const byId = new Map(places.map((p) => [p.id, p]));
  let total = 0;
  for (const id of ordered) total += byId.get(id)?.visitMinutes ?? 0;
  for (let i = 1; i < ordered.length; i++) {
    total += travelSec(travel, ordered[i - 1]!, ordered[i]!) / 60;
  }
  return Math.round(total);
}

// -------------------- utilities --------------------

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}

function computeStateHash(input: OptimizerInput): string {
  const parts: string[] = [];
  const sortedPlaces = [...input.places].sort((a, b) => a.id.localeCompare(b.id));
  for (const p of sortedPlaces) {
    parts.push(`p:${p.id}:${p.lat.toFixed(5)}:${p.lng.toFixed(5)}:${p.visitMinutes}`);
  }
  const sortedLegs = [...input.legs].sort(
    (a, b) => a.fromId.localeCompare(b.fromId) || a.toId.localeCompare(b.toId),
  );
  for (const l of sortedLegs) parts.push(`l:${l.fromId}:${l.toId}:${l.durationSeconds}`);
  parts.push(`b:${input.dailyBudgetMinutes}`);
  if (input.anchorPlaceId) parts.push(`a:${input.anchorPlaceId}`);
  if (input.dayStartEnd) {
    for (const [day, v] of Object.entries(input.dayStartEnd).sort()) {
      parts.push(`d:${day}:${v.startId ?? ''}:${v.endId ?? ''}`);
    }
  }
  // Deterministic, string-compare-friendly hash (not cryptographic).
  return djb2(parts.join('|'));
}

function djb2(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}
