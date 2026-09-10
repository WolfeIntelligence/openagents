import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { createCheckoutSession, isStripeEnabled } from "@/lib/stripe";
import { getCatalog } from "@/lib/catalog";
import { hasPurchased } from "@/lib/purchases";

const bodySchema = z.object({ owner: z.string().min(1), name: z.string().min(1) });

export async function POST(req: NextRequest) {
  if (!isStripeEnabled()) {
    return NextResponse.json({ error: "payments not configured" }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const catalog = await getCatalog();
  const pkg = await catalog.get(parsed.data.owner, parsed.data.name);
  if (!pkg) {
    return NextResponse.json({ error: "package not found" }, { status: 404 });
  }

  const { pricing } = pkg.manifest;
  if (pricing.model === "free") {
    return NextResponse.json({ error: "package is free" }, { status: 400 });
  }
  if (pricing.model === "subscription") {
    return NextResponse.json(
      { error: "subscription pricing is not available yet" },
      { status: 400 }
    );
  }
  if (session.user.handle && session.user.handle === pkg.owner) {
    return NextResponse.json({ error: "you own this package" }, { status: 400 });
  }
  if (await hasPurchased(session.user.id, pkg.owner, pkg.name)) {
    return NextResponse.json({ error: "you already own this package" }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;

  try {
    const { url } = await createCheckoutSession({
      pkg,
      buyerUserId: session.user.id,
      // `{CHECKOUT_SESSION_ID}` is a Stripe template literal — it substitutes the real
      // session id into the redirect URL. The package page uses it to confirm the
      // session directly with Stripe rather than trusting the bare `checkout=success`
      // query param (see confirmCheckoutSession in src/lib/purchases.ts).
      successUrl: `${siteUrl}/p/${pkg.owner}/${pkg.name}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${siteUrl}/p/${pkg.owner}/${pkg.name}?checkout=cancelled`,
    });
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "checkout failed" },
      { status: 400 }
    );
  }
}
