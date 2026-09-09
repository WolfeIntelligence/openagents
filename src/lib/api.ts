// Small helpers shared by every `/api/v1/*` route: consistent JSON envelopes
// and CORS headers (`Access-Control-Allow-Origin: *`) per SPEC.md.

import { NextResponse } from "next/server";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** JSON success response with CORS headers applied. */
export function json<T>(data: T, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value);
  return NextResponse.json(data, { ...init, headers });
}

/** JSON error response shaped `{ error: message }`, with CORS headers applied. */
export function error(status: number, message: string): NextResponse {
  return json({ error: message }, { status });
}

/** Applies CORS headers in place to an arbitrary (non-JSON) Response — e.g. tarball/raw-file routes. */
export function withCors(response: Response): Response {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

/** Standard CORS preflight (204, no body) — return this from a route's `OPTIONS` handler. */
export function preflight(): Response {
  return withCors(new Response(null, { status: 204 }));
}
