// Who is making this request? One helper for every route that accepts either a
// browser session (Auth.js cookie) or a personal access token (`Authorization:
// Bearer oa_...`), so the CLI and browser share the same authorization code paths.
//
// Safe to import with zero env vars: `auth()` resolves to null without providers,
// and token lookup no-ops without a database.

import type { NextRequest } from "next/server";
import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { TOKEN_SCOPES, verifyToken, type TokenScope } from "@/lib/tokens";
import { ensureMachinePrincipal, MACHINE_SCOPES, verifyMachineSecret } from "@/lib/machine";

export interface Requester {
  /** Stable user id (users.id). */
  id: string;
  /** Provider-derived handle; may be undefined for a user whose handle was never set. */
  handle?: string;
  name?: string | null;
  image?: string | null;
  /** How the caller authenticated. Tokens carry scopes; sessions are
   *  unrestricted; "machine" is the OPENAGENTS_MACHINE_SECRET principal —
   *  also scope-limited, like a token (see src/lib/machine.ts). */
  via: "session" | "token" | "machine";
  scopes: string[];
}

// Re-exported for callers that only need the scope vocabulary and would otherwise have
// to know tokens.ts owns it (kept here since this is the module route handlers import
// for auth/scope checks).
export { TOKEN_SCOPES };
export type { TokenScope };

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
 * Resolves the caller from a bearer token (`Authorization: Bearer oa_...`). Delegates
 * the actual lookup/hashing/lastUsedAt bookkeeping to `src/lib/tokens.ts`; this just
 * shapes the result into a `Requester`. Invalid, unknown, revoked, or malformed tokens
 * — and zero-env deployments — all resolve to null, the same "unauthenticated" outcome.
 */
export async function requesterFromBearer(token: string): Promise<Requester | null> {
  const principal = await verifyToken(token);
  if (!principal) return null;
  return {
    id: principal.user.id,
    handle: principal.user.handle ?? undefined,
    name: principal.user.name,
    image: principal.user.image,
    via: "token",
    scopes: principal.scopes,
  };
}

/**
 * Resolves the caller from OPENAGENTS_MACHINE_SECRET (see src/lib/machine.ts).
 * Null for anything that isn't an exact, constant-time match against a
 * configured (>= 32 char) secret, or when the org/user it needs can't be
 * created/found — same "just unauthenticated" contract as `requesterFromBearer`,
 * so `getRequester` can try this first and fall through to ordinary token
 * verification without the two ever being ambiguous (an `oa_`-shaped token can
 * never equal the machine secret, and vice versa).
 */
export async function requesterFromMachineSecret(token: string): Promise<Requester | null> {
  if (!verifyMachineSecret(token)) return null;
  const principal = await ensureMachinePrincipal();
  if (!principal) return null;
  return {
    id: principal.id,
    handle: principal.handle,
    name: "WolfeOS",
    image: null,
    via: "machine",
    scopes: [...MACHINE_SCOPES],
  };
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
    if (!token) return null;
    const machine = await requesterFromMachineSecret(token);
    if (machine) return machine;
    return requesterFromBearer(token);
  }
  return fromSession(await auth());
}

/** True when the requester may perform `scope` (sessions always may). */
export function hasScope(requester: Requester | null, scope: TokenScope): boolean {
  return Boolean(requester && (requester.via === "session" || requester.scopes.includes(scope)));
}
