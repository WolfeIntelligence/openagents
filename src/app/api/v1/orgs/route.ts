import { NextRequest } from "next/server";
import { getRequester, hasScope } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { rateLimit } from "@/lib/ratelimit";
import { createOrg, listOrgsForMember } from "@/lib/orgs";

export const runtime = "nodejs";

// GET  /api/v1/orgs?member=me — the caller's own orgs, with their role in each.
//      `member` currently only accepts the literal "me" (there's no public
//      "orgs by member" listing — memberships aren't otherwise public).
// POST /api/v1/orgs { handle, displayName, bio?, website? } — 201. Creates an
//      org owned solely by the caller (role "owner").
//
// 10 creates/min/user — same order of magnitude as publish/collections-create,
// comfortably above real usage and well below anything spammable.
const WRITE_RATE_LIMIT = { limit: 10, windowMs: 60_000 };

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get("member") !== "me") {
    return error(400, `GET /api/v1/orgs requires "?member=me"`);
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");

  const orgs = await listOrgsForMember(requester.id);
  return json({ items: orgs });
}

export async function POST(request: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "organizations require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in to create an organization");
  if (!hasScope(requester, "publish")) return error(403, "insufficient scope");

  const limited = rateLimit(`orgs:write:${requester.id}`, WRITE_RATE_LIMIT);
  if (!limited.ok) {
    return json(
      { error: "too many requests, slow down" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSeconds) } }
    );
  }

  const body: unknown = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { handle?: unknown }).handle !== "string" ||
    typeof (body as { displayName?: unknown }).displayName !== "string"
  ) {
    return error(400, `body must include string "handle" and "displayName"`);
  }
  const { handle, displayName, bio, website } = body as {
    handle: string;
    displayName: string;
    bio?: unknown;
    website?: unknown;
  };
  if (bio !== undefined && typeof bio !== "string") return error(400, `"bio" must be a string`);
  if (website !== undefined && typeof website !== "string") return error(400, `"website" must be a string`);

  const result = await createOrg(requester, {
    handle,
    displayName,
    bio: bio as string | undefined,
    website: website as string | undefined,
  });
  if (!result.ok) return error(result.status, result.message);
  return json(result.org, { status: 201 });
}

export async function OPTIONS() {
  return preflight();
}
