/**
 * ogMeta.ts — pure helpers for the server-side share-link preview.
 *
 * Imported by the Cloudflare Pages Function `functions/share/[token].ts`
 * (bundled by wrangler, NOT Metro), so this file must stay dependency-free:
 * no React, no React Native, no `@/` aliases.
 */

export interface OgTrip {
  title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}

export interface OgMeta {
  title: string;
  description: string;
}

/** Escapes a string for safe use in HTML text or a double-quoted attribute. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseIsoDate(value: string | null | undefined): { y: number; m: number; d: number } | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** "12–18 Jun 2026", "28 Jun – 3 Jul 2026", "30 Dec 2026 – 2 Jan 2027", or "12 Jun 2026". */
export function formatDateRange(start?: string | null, end?: string | null): string | null {
  const s = parseIsoDate(start);
  const e = parseIsoDate(end);
  const fmt = (p: { y: number; m: number; d: number }, withYear: boolean, withMonth = true) =>
    `${p.d}${withMonth ? ` ${MONTHS[p.m - 1]}` : ''}${withYear ? ` ${p.y}` : ''}`;
  if (s && e) {
    if (s.y === e.y && s.m === e.m && s.d === e.d) return fmt(s, true);
    if (s.y === e.y && s.m === e.m) return `${s.d}–${fmt(e, true)}`;
    if (s.y === e.y) return `${fmt(s, false)} – ${fmt(e, true)}`;
    return `${fmt(s, true)} – ${fmt(e, true)}`;
  }
  const only = s ?? e;
  return only ? fmt(only, true) : null;
}

/** Title + description for a shared trip's link preview (unescaped). */
export function buildShareOgMeta(trip: OgTrip, placeCount: number): OgMeta {
  const name = (trip.title ?? '').trim().slice(0, 120) || 'Untitled trip';
  const parts: string[] = [];
  const dates = formatDateRange(trip.start_date, trip.end_date);
  if (dates) parts.push(dates);
  parts.push(placeCount === 1 ? '1 place' : `${Math.max(0, placeCount)} places`);
  return {
    title: `${name} · Tripvisor`,
    description: `${parts.join(' · ')} — a read-only trip plan on Tripvisor. No sign-in needed.`,
  };
}
