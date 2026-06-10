// weather — proxies the Open-Meteo daily forecast API (v2 Phase P2.1).
//
// Why a proxy at all when Open-Meteo needs NO key: (1) one consistent error
// envelope + structured logging across every outbound integration, (2) the
// client talks only to Supabase (CORS, auth, observability in one place),
// (3) if we ever move to a keyed weather tier, no client change is needed.
//
// Contract:
//   POST { lat: number, lng: number, startDate: 'YYYY-MM-DD', days: 1..16 }
//   -> 200 {
//        days: [{
//          date: 'YYYY-MM-DD',
//          weatherCode: int,            // WMO code (Open-Meteo weather_code)
//          tMaxC: number,
//          tMinC: number,
//          precipProbMax: int | null    // % — null when the model has no value
//        }]
//      }
//      with Cache-Control: private, max-age=3600 (forecasts update hourly;
//      pairs with the client's staleTime of 1h).
//
//   GET ?ping -> { ok: true, fn: 'weather' } (warmup / health).
//
// Error envelope (shared { error: { code, message } } shape):
//   not_authenticated 401 · invalid_input 400 · method_not_allowed 405 ·
//   upstream_error 502 · upstream_timeout 504
//
// Auth: the Supabase gateway verifies the JWT before this code runs
// (verify_jwt defaults to true — there is deliberately NO config.toml
// override for this function). The bearer-presence check below is belt-and-
// braces for a misconfigured local `functions serve --no-verify-jwt`; we do
// NOT round-trip auth.getUser() because no per-user state is read — the
// forecast is public data and the only thing being protected is the proxy.
//
// Attribution (CC-BY 4.0): Open-Meteo data requires visible attribution —
// "Weather data by Open-Meteo.com" — wherever a forecast renders. That is
// the UI wave's responsibility (see README.md next to this file).
//
// No secrets used: Open-Meteo's free tier is keyless. Nothing from the
// response is ever persisted server-side — the client React Query cache
// (staleTime 1h / gcTime 6h) is the only cache beyond the HTTP header.

import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts';
import { handlePreflight } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/errors.ts';
import { fetchWithTimeout } from '../_shared/fetch-with-timeout.ts';
import { log, newRequestId } from '../_shared/logger.ts';

const TIMEOUT_MS = 8_000;

// Open-Meteo's standard forecast horizon is 16 days; the Zod cap mirrors it
// so out-of-range asks fail fast as invalid_input instead of upstream_error.
const MAX_DAYS = 16;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const BodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  startDate: z
    .string()
    .regex(ISO_DATE, 'startDate must be YYYY-MM-DD')
    .refine(isRealUtcDate, 'startDate is not a valid calendar date'),
  days: z.number().int().min(1).max(MAX_DAYS),
});

interface OpenMeteoDailyBlock {
  time?: string[];
  weather_code?: Array<number | null>;
  temperature_2m_max?: Array<number | null>;
  temperature_2m_min?: Array<number | null>;
  precipitation_probability_max?: Array<number | null>;
}

interface OpenMeteoResponse {
  daily?: OpenMeteoDailyBlock;
  error?: boolean;
  reason?: string;
}

export interface WeatherDay {
  date: string;
  weatherCode: number;
  tMaxC: number;
  tMinC: number;
  precipProbMax: number | null;
}

export async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const requestId = newRequestId();

  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const url = new URL(req.url);
  if (url.searchParams.has('ping')) {
    return jsonResponse({ ok: true, fn: 'weather' }, { origin });
  }

  if (req.method !== 'POST') {
    return errorResponse('method_not_allowed', 'Only POST is allowed', 405, origin);
  }

  // Belt-and-braces auth check — see the module header. The gateway
  // (verify_jwt: true, the default) already rejected unauthenticated calls.
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return errorResponse('not_authenticated', 'Missing bearer token', 401, origin);
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return errorResponse(
      'invalid_input',
      err instanceof z.ZodError ? err.issues.map((i) => i.message).join('; ') : 'Invalid JSON',
      400,
      origin,
    );
  }

  const endDate = addUtcDays(body.startDate, body.days - 1);
  const start = Date.now();

  const params = new URLSearchParams({
    latitude: String(body.lat),
    longitude: String(body.lng),
    daily:
      'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    start_date: body.startDate,
    end_date: endDate,
  });

  try {
    const upstream = await fetchWithTimeout(
      `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
      { method: 'GET' },
      TIMEOUT_MS,
    );

    if (!upstream.ok) {
      // Open-Meteo returns 400 { error: true, reason } for e.g. a start_date
      // beyond the 16-day horizon. Surface a trimmed reason so the client can
      // show something better than "weather unavailable".
      const text = await upstream.text().catch(() => '');
      let reason = '';
      try {
        const parsed = JSON.parse(text) as OpenMeteoResponse;
        if (typeof parsed.reason === 'string') reason = parsed.reason;
      } catch {
        // non-JSON error body — fall through with the generic message
      }
      log({
        requestId,
        fn: 'weather',
        level: 'error',
        status: upstream.status,
        reason: reason.slice(0, 200) || text.slice(0, 200),
        durationMs: Date.now() - start,
      });
      return errorResponse(
        'upstream_error',
        reason ? `Forecast unavailable: ${reason.slice(0, 200)}` : 'Open-Meteo returned an error',
        502,
        origin,
      );
    }

    const payload = (await upstream.json()) as OpenMeteoResponse;
    const daily = payload.daily;
    const time = daily?.time;
    if (!daily || !Array.isArray(time)) {
      log({
        requestId,
        fn: 'weather',
        level: 'error',
        err: 'malformed_upstream_response',
        durationMs: Date.now() - start,
      });
      return errorResponse('upstream_error', 'Open-Meteo response was malformed', 502, origin);
    }

    const days: WeatherDay[] = [];
    for (let i = 0; i < time.length; i++) {
      const date = time[i];
      const weatherCode = numberAt(daily.weather_code, i);
      const tMaxC = numberAt(daily.temperature_2m_max, i);
      const tMinC = numberAt(daily.temperature_2m_min, i);
      // Core fields null (can happen at the far edge of the horizon): skip
      // the day rather than invent values — the client maps days by `date`,
      // so a gap degrades to "no chip for that day", never misalignment.
      if (typeof date !== 'string' || weatherCode === null || tMaxC === null || tMinC === null) {
        continue;
      }
      const precip = numberAt(daily.precipitation_probability_max, i);
      days.push({
        date,
        weatherCode: Math.round(weatherCode),
        tMaxC,
        tMinC,
        precipProbMax: precip === null ? null : Math.round(precip),
      });
    }

    log({
      requestId,
      fn: 'weather',
      level: 'info',
      // Coordinates rounded to ~1km in logs — enough to debug, not enough to
      // profile a user's exact saved locations from log drains.
      lat: round2(body.lat),
      lng: round2(body.lng),
      requestedDays: body.days,
      returnedDays: days.length,
      durationMs: Date.now() - start,
    });

    return jsonResponse(
      { days },
      // Forecast models refresh roughly hourly; mirror the client staleTime.
      // `private`: per-user gateways/proxies must not share cached bodies.
      { origin, headers: { 'Cache-Control': 'private, max-age=3600' } },
    );
  } catch (err) {
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    log({
      requestId,
      fn: 'weather',
      level: 'error',
      err: isAbort ? 'timeout' : String(err),
      durationMs: Date.now() - start,
    });
    return errorResponse(
      isAbort ? 'upstream_timeout' : 'upstream_error',
      'Open-Meteo request failed',
      isAbort ? 504 : 502,
      origin,
    );
  }
}

/** True when `s` (already shape-checked YYYY-MM-DD) is a real UTC calendar date. */
function isRealUtcDate(s: string): boolean {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** startDate + n days, in UTC, as YYYY-MM-DD (no DST drift possible). */
function addUtcDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** arr[i] when it is a finite number, else null. */
function numberAt(arr: Array<number | null> | undefined, i: number): number | null {
  const v = arr?.[i];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

Deno.serve(handler);
