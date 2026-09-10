import { NextRequest } from "next/server";
import { z } from "zod";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { getRequester } from "@/lib/requester";
import { getOwnProfile, updateOwnProfile } from "@/lib/profile";

export const runtime = "nodejs";

// GET/PUT /api/v1/profile — read/update the caller's own profile. Works for
// either a browser session or a bearer token (`getRequester`); `image` isn't
// editable here since it comes from the OAuth provider, not from this form.

const putBodySchema = z.object({
  name: z.string().max(200).optional(),
  bio: z.string().max(2000).optional(),
  website: z.string().max(2000).optional(),
  handle: z.string().max(64).optional(),
});

export async function GET(request: NextRequest) {
  const requester = await getRequester(request);
  if (!requester) {
    return error(401, "sign in required");
  }
  if (!isDbEnabled()) {
    return error(503, "profile editing requires a database; none is configured on this deployment");
  }

  const profile = await getOwnProfile(requester.id);
  if (!profile) {
    return error(404, "user not found");
  }
  return json(profile);
}

export async function PUT(request: NextRequest) {
  const requester = await getRequester(request);
  if (!requester) {
    return error(401, "sign in required");
  }
  if (!isDbEnabled()) {
    return error(503, "profile editing requires a database; none is configured on this deployment");
  }

  const body = await request.json().catch(() => null);
  const parsed = putBodySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "invalid body", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }

  const result = await updateOwnProfile(requester.id, parsed.data);
  if (!result.ok) {
    return error(result.status, result.message);
  }
  return json(result.profile);
}

export async function OPTIONS() {
  return preflight();
}
