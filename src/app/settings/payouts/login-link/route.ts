import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb, isDbEnabled } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { createExpressLoginLink, isStripeEnabled } from "@/lib/stripe";

export const runtime = "nodejs";

// POST /settings/payouts/login-link — session-only page action (not under `/api/v1`,
// the public catalog surface, so it skips that group's CORS envelope) backing the
// "Open Stripe dashboard" button on `/settings/payouts`. Mints a fresh, single-use
// Stripe Express Dashboard login link for the caller's own connected account —
// never anyone else's.
export async function POST() {
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

  const [user] = await db.select().from(users).where(eq(users.id, session.user.id)).limit(1);
  if (!user?.stripeAccountId) {
    return NextResponse.json({ error: "no connected Stripe account" }, { status: 400 });
  }

  try {
    const { url } = await createExpressLoginLink(user.stripeAccountId);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed to create a Stripe login link" },
      { status: 502 }
    );
  }
}
