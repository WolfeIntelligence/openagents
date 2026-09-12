// Auth.js v5 config. Safe to import with zero env vars:
//  - providers is [] unless at least one of GitHub (AUTH_GITHUB_ID/AUTH_GITHUB_SECRET) or
//    Google (AUTH_GOOGLE_ID/AUTH_GOOGLE_SECRET) is configured (isAuthEnabled()).
//  - the Drizzle adapter (database sessions) is only wired up when the DB is enabled;
//    otherwise sessions fall back to JWT.
//  - auth() resolves to a null session when nothing is configured / no cookie is present.
//
// UI usage: `const session = await auth()` in a server component or route handler.
// `session?.user?.handle` is the provider-derived handle (only populated in DB mode, since
// JWT-only mode has nowhere durable to look up a stored handle across devices — the raw
// provider login/email is still available via the token for the lifetime of that session).
// GitHub -> handle is the GitHub login. Google -> handle is derived from the email
// local-part (lowercased, sanitized, deduped against existing handles in DB mode).

import NextAuth, { type DefaultSession } from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import type {} from "next-auth/jwt";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { isHandleTaken, isReservedHandle } from "@/lib/reserved";

export type ProviderId = "github" | "google";

interface ProviderInfo {
  id: ProviderId;
  name: string;
}

function isGitHubEnabled(): boolean {
  return Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
}

function isGoogleEnabled(): boolean {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

/** Providers enabled on this deployment, in display order. */
export function enabledProviders(): ProviderInfo[] {
  const list: ProviderInfo[] = [];
  if (isGitHubEnabled()) list.push({ id: "github", name: "GitHub" });
  if (isGoogleEnabled()) list.push({ id: "google", name: "Google" });
  return list;
}

/** Sanitize an email local-part (or any raw string) into a handle-safe slug, max 39 chars. */
function slugifyHandle(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39)
    .replace(/-+$/g, "");
}

/**
 * Derive a unique handle from a raw base string (a GitHub login, or the local-part of a
 * Google email). Slugified first; appends -2, -3, ... when the result is reserved
 * (B12a — blocklist + seed catalog owners), already taken by a *different* user, or
 * (G-P3) already taken by an organization — orgs and users share one handle namespace.
 * In JWT-only mode (no `db`) there is nowhere durable to check collisions against other
 * users/orgs, so only the reserved-word check applies.
 */
async function uniqueHandle(
  base: string,
  userId: string | undefined,
  db: ReturnType<typeof getDb>
): Promise<string> {
  const slug = slugifyHandle(base) || "user";

  let candidate = slug;
  let suffix = 2;
  // Cap the length so the `-N` suffix never pushes past 39 chars.
  const maxBaseLen = 39;
  while (true) {
    let taken = isReservedHandle(candidate);
    if (!taken && db) {
      taken = await isHandleTaken(candidate, { excludeUserId: userId });
    }
    if (!taken) return candidate;
    const suffixStr = `-${suffix}`;
    candidate = `${slug.slice(0, maxBaseLen - suffixStr.length)}${suffixStr}`;
    suffix += 1;
  }
}

declare module "next-auth" {
  interface Session {
    user: {
      id?: string;
      handle?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    handle?: string;
  }
}

export function isAuthEnabled(): boolean {
  return enabledProviders().length > 0;
}

const db = getDb();
const dbEnabled = isDbEnabled() && Boolean(db);

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  // Auth.js throws MissingSecret on every request (even /api/auth/providers with zero
  // providers) if `secret` is undefined. Fall back to a fixed placeholder when AUTH_SECRET
  // isn't set so the app never 500s with zero env vars; this placeholder never protects a
  // real session because isAuthEnabled() is false and providers is [] in that case.
  secret: process.env.AUTH_SECRET ?? "openagents-unconfigured-auth-secret",
  adapter:
    dbEnabled && db
      ? DrizzleAdapter(db, {
          usersTable: users,
          accountsTable: accounts,
          sessionsTable: sessions,
          verificationTokensTable: verificationTokens,
        })
      : undefined,
  session: { strategy: dbEnabled ? "database" : "jwt" },
  providers: [
    ...(isGitHubEnabled()
      ? [
          GitHub({
            clientId: process.env.AUTH_GITHUB_ID,
            clientSecret: process.env.AUTH_GITHUB_SECRET,
          }),
        ]
      : []),
    ...(isGoogleEnabled()
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID,
            clientSecret: process.env.AUTH_GOOGLE_SECRET,
          }),
        ]
      : []),
  ],
  // Persist a provider-derived handle on the DB user record so it survives across
  // sessions/devices and can be used for owner checks in publish.ts.
  // GitHub -> the GitHub login. Google -> slugified email local-part, deduped.
  // This lives in `events.signIn` rather than `callbacks.signIn` because, with a database
  // adapter, the callback runs BEFORE a first-time user row exists (user.id is still the
  // provider's id there), so an update from the callback matches nothing.
  events: {
    async signIn({ user, account, profile }) {
      if (!dbEnabled || !db || !profile || !user.id) return;

      // B12b: a handle is set once, on first sign-in, and never rewritten after that. A
      // renamed GitHub login (or a Google account whose email local-part changed) would
      // otherwise silently orphan every package published under the old handle — owner
      // checks in publish.ts and `/u/<handle>` both key off this column, not off a stable
      // internal id. Self-service handle change (with a migration of `packages.owner` to
      // match) is future work; until then the first handle sticks.
      const [existingRow] = await db
        .select({ handle: users.handle })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      if (existingRow?.handle) return;

      let base: string | undefined;
      if (account?.provider === "github") {
        base = (profile as { login?: string }).login;
      } else if (account?.provider === "google") {
        const email = (profile as { email?: string }).email;
        base = email ? (email.split("@")[0] ?? email) : undefined;
      }
      if (!base) return;

      const handle = await uniqueHandle(base, user.id, db);
      await db.update(users).set({ handle }).where(eq(users.id, user.id));
    },
  },
  callbacks: {
    // JWT-mode: stash the derived handle on first sign-in so it's available on session.
    async jwt({ token, profile, account }) {
      if (account?.provider === "github" && profile) {
        const login = (profile as { login?: string }).login;
        if (login) token.handle = await uniqueHandle(login, undefined, null);
      } else if (account?.provider === "google" && profile) {
        const email = (profile as { email?: string }).email;
        if (email) token.handle = await uniqueHandle(email.split("@")[0] ?? email, undefined, null);
      }
      return token;
    },
    async session({ session, user, token }) {
      if (dbEnabled) {
        const dbUser = user as typeof users.$inferSelect | undefined;
        session.user.handle = dbUser?.handle ?? undefined;
        if (dbUser?.id) session.user.id = dbUser.id;
      } else {
        session.user.handle = token.handle;
        if (token.sub) session.user.id = token.sub;
      }
      return session;
    },
  },
});
