import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { organizations, users } from "@/lib/db/schema";
import { createExpressLoginLink, isStripeEnabled } from "@/lib/stripe";
import { getMemberRole } from "@/lib/orgs";

export const runtime = "nodejs";

/** Body is optional — same convention as `/api/connect/onboard`: `{}`/no body means
 *  the caller's own account, `{ org: "<handle>" }` means that organization's. */
async function parseTargetOrg(req: NextRequest): Promise<string | undefined> {
  try {
    const body: unknown = await req.json();
    if (body && typeof body === "object" && typeof (body as { org?: unknown }).org === "string") {
      return (body as { org: string }).org.trim().toLowerCase();
    }
  } catch {
    // No body (or not JSON) — the caller's own account.
  }
  return undefined;
}

// POST /settings/payouts/login-link — session-only page action (not under `/api/v1`,
// the public catalog surface, so it skips that group's CORS envelope) backing the
// "Open Stripe dashboard" button on `/settings/payouts` and `/settings/orgs`. Mints a
// fresh, single-use Stripe Express Dashboard login link for the caller's own connected
// account, or (with `{ org }`, gated on owner/admin) an organization's.
export async function POST(req: NextRequest) {
  if (!isDbEnabled() || !isStripeEnabled()) {
    return NextResponse.json({ error: "payments not configured" }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json({ error: "payments not configured" }, { status: 503 });
  }

  const orgHandle = await parseTargetOrg(req);

  let accountId: string | null;
  if (orgHandle) {
    const role = await getMemberRole(orgHandle, session.user.id);
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json(
        { error: "you must be an owner or admin of that organization" },
        { status: 403 }
      );
    }
    const [org] = await db
      .select({ stripeAccountId: organizations.stripeAccountId })
      .from(organizations)
      .where(eq(organizations.handle, orgHandle))
      .limit(1);
    accountId = org?.stripeAccountId ?? null;
  } else {
    const [user] = await db
      .select({ stripeAccountId: users.stripeAccountId })
      .from(users)
      .where(eq(users.id, session.user.id))
      .limit(1);
    accountId = user?.stripeAccountId ?? null;
  }

  if (!accountId) {
    return NextResponse.json({ error: "no connected Stripe account" }, { status: 400 });
  }

  try {
    const { url } = await createExpressLoginLink(accountId);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to create a Stripe login link" },
      { status: 502 }
    );
  }
}
