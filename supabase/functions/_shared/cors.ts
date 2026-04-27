// Fails closed: if ALLOWED_ORIGINS is unset, no cross-origin request is allowed.
// Set ALLOWED_ORIGINS to a comma-separated list (or '*' for local dev only).
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function corsHeaders(origin: string | null): Headers {
  // GET is included for the place-photo function (Phase 25), which streams
  // image bytes back via the URL embedded in `<Image src>`. Every other
  // function uses POST; allowing GET here is a no-op for them.
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client-Info, apikey',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  });
  if (ALLOWED_ORIGINS.includes('*')) {
    headers.set('Access-Control-Allow-Origin', '*');
  } else if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }
  return headers;
}

export function handlePreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}
