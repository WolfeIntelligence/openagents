import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createConnectOnboardingLink, isStripeEnabled, type ConnectOwner } from "@/lib/stripe";
import { getMemberRole } from "@/lib/orgs";

/** Body is optional — `{}` (or no body at all) onboards the caller's own personal
 *  payout account, same as before this accepted an org. `{ org: "<handle>" }` onboards
 *  that organization's shared payout account instead, gated on the caller being an
 *  owner or admin of it (a plain "member" can publish under an org but not manage its
 *  money — same split `publish.ts` and `orgs.ts` use everywhere else). */
async function parseTargetOrg(req: NextRequest): Promise<string | undefined> {
  try {
    const body: unknown = await req.json();
    if (body && typeof body === "object" && typeof (body as { org?: unknown }).org === "string") {
      return (body as { org: string }).org.trim().toLowerCase();
    }
  } catch {
    // No body (or not JSON) — personal onboarding, the common case.
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  if (!isStripeEnabled()) {
    return NextResponse.json({ error: "payments not configured" }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const orgHandle = await parseTargetOrg(req);

  let owner: ConnectOwner;
  let returnPath: string;
  if (orgHandle) {
    const role = await getMemberRole(orgHandle, session.user.id);
    if (role !== "owner" && role !== "admin") {
      return NextResponse.json(
        { error: "you must be an owner or admin of that organization" },
        { status: 403 }
      );
    }
    owner = { kind: "org", orgHandle };
    returnPath = `/settings/orgs?connected=${encodeURIComponent(orgHandle)}`;
  } else {
    owner = { kind: "user", userId: session.user.id };
    returnPath = "/settings/payouts?connected=1";
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  const refreshPath = orgHandle
    ? `/settings/orgs?refresh=${encodeURIComponent(orgHandle)}`
    : "/settings/payouts?refresh=1";

  try {
    const { url } = await createConnectOnboardingLink(owner, `${siteUrl}${returnPath}`, `${siteUrl}${refreshPath}`);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "onboarding failed" },
      { status: 400 }
    );
  }
}
