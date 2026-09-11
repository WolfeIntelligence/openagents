import { NextRequest } from "next/server";
import { getRequester } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { clientIp, RATE_LIMITS, withRateLimit } from "@/lib/ratelimit";
import { createReport, PackageActionError } from "@/lib/moderation";
import { notifyReportCreated } from "@/lib/notify";

export const runtime = "nodejs";

// POST /api/v1/packages/[owner]/[name]/report — anyone, signed in or not.
//   { reason: "prompt-injection" | "malware" | "license" | "spam" | "other", details? }
//
// Anonymous reports are allowed (reporterUserId stays null) but rate-limited
// harder per IP than a signed-in report per user, since an IP is a much
// coarser and more spoofable identity than an authenticated account.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  if (!isDbEnabled()) {
    return error(503, "reporting requires a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  const key = requester ? `report:user:${requester.id}` : `report:ip:${clientIp(request)}`;
  const limited = await withRateLimit(request, "report", {
    ...(requester ? RATE_LIMITS.reportSignedIn : RATE_LIMITS.reportAnonymous),
    key,
    message: "too many reports, slow down",
  });
  if (limited) return limited;

  const body: unknown = await request.json().catch(() => null);
  const { reason, details } = (body ?? {}) as { reason?: unknown; details?: unknown };
  if (typeof reason !== "string") {
    return error(400, `body must include a string "reason"`);
  }

  try {
    const result = await createReport({
      owner,
      name,
      reason,
      details: typeof details === "string" ? details : undefined,
      reporterUserId: requester?.id ?? null,
    });
    // Best-effort admin email; never delays or fails the report itself.
    void notifyReportCreated({
      reportId: result.id,
      owner,
      name,
      reason,
      details: typeof details === "string" ? details : null,
    });
    return json(result, { status: 201 });
  } catch (err) {
    if (err instanceof PackageActionError) return error(err.status, err.message);
    console.error(`[api] ${new URL(request.url).pathname}:`, err);
    return error(503, "temporarily unavailable; try again shortly");
  }
}

export async function OPTIONS() {
  return preflight();
}
