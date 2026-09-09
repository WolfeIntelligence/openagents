// Auth.js v5 config. Safe to import with zero env vars:
//  - providers is [] unless AUTH_GITHUB_ID/AUTH_GITHUB_SECRET are set (isAuthEnabled()).
//  - the Drizzle adapter (database sessions) is only wired up when the DB is enabled;
//    otherwise sessions fall back to JWT.
//  - auth() resolves to a null session when nothing is configured / no cookie is present.
//
// UI usage: `const session = await auth()` in a server component or route handler.
// `session?.user?.handle` is the GitHub-derived handle (only populated in DB mode, since
// JWT-only mode has nowhere durable to look up a stored handle across devices — the raw
// GitHub login is still available via the token for the lifetime of that session).

import NextAuth, { type DefaultSession } from "next-auth";
import GitHub from "next-auth/providers/github";
import type {} from "next-auth/jwt";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";

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
  return Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET);
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
  providers: isAuthEnabled()
    ? [
        GitHub({
          clientId: process.env.AUTH_GITHUB_ID,
          clientSecret: process.env.AUTH_GITHUB_SECRET,
        }),
      ]
    : [],
  callbacks: {
    // Persist the GitHub login as `handle` on the DB user record so it survives
    // across sessions/devices and can be used for owner checks in publish.ts.
    async signIn({ user, account, profile }) {
      if (dbEnabled && db && account?.provider === "github" && profile && user.id) {
        const login = (profile as { login?: string }).login;
        if (login) {
          await db.update(users).set({ handle: login }).where(eq(users.id, user.id));
        }
      }
      return true;
    },
    // JWT-mode: stash the GitHub login on first sign-in so it's available on session.
    async jwt({ token, profile, account }) {
      if (account?.provider === "github" && profile) {
        const login = (profile as { login?: string }).login;
        if (login) token.handle = login;
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
