import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createConnectOnboardingLink, isStripeEnabled } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  if (!isStripeEnabled()) {
    return NextResponse.json({ error: "payments not configured" }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;

  try {
    const { url } = await createConnectOnboardingLink(
      session.user.id,
      `${siteUrl}/settings/payments`
    );
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "onboarding failed" },
      { status: 400 }
    );
  }
}
