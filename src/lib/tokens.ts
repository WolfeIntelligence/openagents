// Personal access tokens (G-T1): CLI-facing auth that doesn't require a browser
// session. A token's plaintext is shown exactly once at creation time; only its
// SHA-256 hash is ever stored, so a leaked database dump can't be replayed as
// live tokens.
//
// Safe to import with zero env vars: every DB-touching export checks
// isDbEnabled()/getDb() first and returns null/throws a clean TokenError
// instead of crashing on a missing client.

import { randomBytes, createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { apiTokens, users } from "@/lib/db/schema";

/** Scopes a token can carry. A session (browser cookie) implicitly has all of them —
 *  this is the token-only subset, defined here since tokens are the only thing that
 *  actually restricts by scope. */
export const TOKEN_SCOPES = ["read", "publish", "star", "download"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** `oa_` + 40 lowercase hex chars (20 random bytes). */
export const TOKEN_RE = /^oa_[0-9a-f]{40}$/;

const MAX_ACTIVE_TOKENS = 20;
const MAX_NAME_LENGTH = 64;
// lastUsedAt is updated at most this often per token, so a hot CLI loop doesn't turn
// every authenticated request into a write.
const LAST_USED_THROTTLE_MS = 60_000;

/** Thrown for any token-management failure; `status` is the HTTP status the route should return. */
export class TokenError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "TokenError";
    this.status = status;
  }
}

export interface TokenSummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface CreatedToken extends TokenSummary {
  /** Plaintext — only ever returned here, at creation time. */
  token: string;
}

export interface TokenPrincipal {
  user: { id: string; handle: string | null; name: string | null; image: string | null };
  scopes: string[];
  tokenId: string;
}

/** SHA-256 of the plaintext token, hex-encoded. This is the only form stored in `tokenHash`. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Validates `oa_`-token shape and returns its parts, or null if `token` isn't
 * shaped like one at all (so callers can fail fast without touching the DB).
 */
export function parseToken(token: string): { prefix: string } | null {
  if (!TOKEN_RE.test(token)) return null;
  // First 8 hex chars after "oa_" — enough to tell tokens apart in a UI list
  // without revealing enough to help guess the rest.
  return { prefix: token.slice(3, 11) };
}

function assertValidScopes(scopes: string[]): void {
  for (const scope of scopes) {
    if (!(TOKEN_SCOPES as readonly string[]).includes(scope)) {
      throw new TokenError(400, `invalid scope: "${scope}" (allowed: ${TOKEN_SCOPES.join(", ")})`);
    }
  }
}

export interface CreateTokenArgs {
  userId: string;
  name: string;
  scopes?: string[];
}

export async function createToken({ userId, name, scopes }: CreateTokenArgs): Promise<CreatedToken> {
  const db = getDb();
  if (!db) throw new TokenError(503, "database not configured");

  const trimmedName = name.trim();
  if (trimmedName.length < 1 || trimmedName.length > MAX_NAME_LENGTH) {
    throw new TokenError(400, `name must be 1-${MAX_NAME_LENGTH} characters`);
  }

  const resolvedScopes = scopes && scopes.length ? [...new Set(scopes)] : [...TOKEN_SCOPES];
  assertValidScopes(resolvedScopes);

  const active = await db
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)));
  if (active.length >= MAX_ACTIVE_TOKENS) {
    throw new TokenError(400, `you already have ${MAX_ACTIVE_TOKENS} active tokens; revoke one first`);
  }

  const plaintext = `oa_${randomBytes(20).toString("hex")}`;
  const parsed = parseToken(plaintext);
  /* istanbul ignore next -- parseToken can't fail on a value we just generated to match TOKEN_RE */
  if (!parsed) throw new TokenError(500, "failed to generate token");

  const [row] = await db
    .insert(apiTokens)
    .values({
      userId,
      name: trimmedName,
      tokenHash: hashToken(plaintext),
      prefix: parsed.prefix,
      scopes: resolvedScopes,
    })
    .returning({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scopes: apiTokens.scopes,
      createdAt: apiTokens.createdAt,
    });

  return { ...row, token: plaintext, lastUsedAt: null };
}

/** Active (non-revoked) tokens for `userId`, newest first. Never includes `tokenHash`. */
export async function listTokens(userId: string): Promise<TokenSummary[]> {
  const db = getDb();
  if (!db) return [];

  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scopes: apiTokens.scopes,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));
}

/** Revokes a token owned by `userId`. Returns true if a live token was found and revoked. */
export async function revokeToken(userId: string, tokenId: string): Promise<boolean> {
  const db = getDb();
  if (!db) throw new TokenError(503, "database not configured");

  const [row] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });

  return Boolean(row);
}

/**
 * Resolves a bearer-token plaintext to its owning user and scopes. Returns null for
 * anything that isn't a live, unrevoked token (malformed, unknown, or revoked) —
 * callers should treat that as "unauthenticated", not surface why.
 */
export async function verifyToken(token: string): Promise<TokenPrincipal | null> {
  if (!parseToken(token)) return null;
  if (!isDbEnabled()) return null;
  const db = getDb();
  if (!db) return null;

  const hash = hashToken(token);
  // A DB error (unreachable, or the api_tokens table not migrated yet) must read as
  // "not authenticated", never as a 500 that leaks whether the token was well-formed.
  let rows: Awaited<ReturnType<typeof lookup>>;
  try {
    rows = await lookup();
  } catch {
    return null;
  }
  const [row] = rows;
  async function lookup() {
    return db!
    .select({
      tokenId: apiTokens.id,
      scopes: apiTokens.scopes,
      lastUsedAt: apiTokens.lastUsedAt,
      userId: users.id,
      handle: users.handle,
      name: users.name,
      image: users.image,
    })
    .from(apiTokens)
    .innerJoin(users, eq(apiTokens.userId, users.id))
    .where(and(eq(apiTokens.tokenHash, hash), isNull(apiTokens.revokedAt)))
    .limit(1);
  }

  if (!row) return null;

  const staleEnough =
    !row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS;
  if (staleEnough) {
    // Best-effort — a failed touch shouldn't fail the request it's authorizing.
    db.update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, row.tokenId))
      .catch(() => {});
  }

  return {
    user: { id: row.userId, handle: row.handle, name: row.name, image: row.image },
    scopes: row.scopes,
    tokenId: row.tokenId,
  };
}
