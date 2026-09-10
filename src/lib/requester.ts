// Who is making this request? One helper for every route that accepts either a
// browser session (Auth.js cookie) or a personal access token (`Authorization:
// Bearer oa_...`), so the CLI and browser share the same authorization code paths.
//
// Safe to import with zero env vars: `auth()` resolves to null without providers,
// and token lookup no-ops without a database.

import type { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";

export interface Requester {
  /** Stable user id (users.id). */
  id: string;
  /** Provider-derived handle; may be undefined for a user whose handle was never set. */
  handle?: string;
  name?: string | null;
  image?: string | null;
  /** How the caller authenticated. Tokens carry scopes; sessions are unrestricted. */
  via: "session" | "token";
  scopes: string[];
}

/** Bearer token scopes. A session implicitly has all of them. */
export const TOKEN_SCOPES = ["read", "publish", "star", "download"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

function fromSession(session: Session | null): Requester | null {
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    handle: session.user.handle ?? undefined,
    name: session.user.name,
    image: session.user.image,
    via: "session",
    scopes: [...TOKEN_SCOPES],
  };
}

/**
 * Resolves the caller from a bearer token. Implemented by the API-tokens
 * workstream in `src/lib/tokens.ts`; until then every bearer token is rejected,
 * which is the safe default.
 */
export async function requesterFromBearer(_token: string): Promise<Requester | null> {
  return null;
}

/**
 * Resolves the requester for a route handler or server component. Pass the
 * `NextRequest` when you have one so bearer tokens are honoured; server
 * components (no request object) fall back to the session cookie only.
 */
export async function getRequester(request?: NextRequest | Request): Promise<Requester | null> {
  const header = request?.headers.get("authorization");
  if (header && /^bearer\s+/i.test(header)) {
    const token = header.replace(/^bearer\s+/i, "").trim();
    if (token) return requesterFromBearer(token);
    return null;
  }
  return fromSession(await auth());
}

/** True when the requester may perform `scope` (sessions always may). */
export function hasScope(requester: Requester | null, scope: TokenScope): boolean {
  return Boolean(requester && (requester.via === "session" || requester.scopes.includes(scope)));
}
