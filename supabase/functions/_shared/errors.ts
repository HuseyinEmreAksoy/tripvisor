import { corsHeaders } from './cors.ts';

export function jsonResponse(
  body: unknown,
  init: ResponseInit & { origin?: string | null } = {},
): Response {
  const { origin = null, headers: extraHeaders, ...rest } = init;
  const headers = corsHeaders(origin);
  headers.set('Content-Type', 'application/json');
  if (extraHeaders) new Headers(extraHeaders).forEach((v, k) => headers.set(k, v));
  return new Response(JSON.stringify(body), { ...rest, headers });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  origin: string | null,
): Response {
  return jsonResponse({ error: { code, message } }, { status, origin });
}
