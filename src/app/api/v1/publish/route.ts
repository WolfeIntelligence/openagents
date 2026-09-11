import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequester, hasScope } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { publishPackage, PublishError } from "@/lib/publish";

export const runtime = "nodejs";

const bodySchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      content: z.string(),
      // "base64" when `content` is base64-encoded binary; absent means text
      // (publishPackage's own validation rejects anything else, plus the
      // 0o644/0o755-only mode check — see VALID_MODES in lib/publish.ts).
      encoding: z.enum(["utf8", "base64"]).optional(),
      mode: z.number().int().optional(),
    })
  ),
  // Optional "what changed in this version" note; publishPackage falls back to
  // CHANGELOG.md's first section when this is absent (B6d).
  changelog: z.string().optional(),
});

export async function POST(req: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "database not configured");
  }

  const requester = await getRequester(req);
  if (!requester) {
    return error(401, "unauthorized");
  }
  if (!hasScope(requester, "publish")) {
    return error(403, "insufficient scope");
  }
  if (!requester.handle) {
    return error(401, "unauthorized");
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "invalid body", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }

  try {
    const result = await publishPackage({
      userHandle: requester.handle,
      files: parsed.data.files,
      changelog: parsed.data.changelog,
    });
    return json(result, { status: 201 });
  } catch (err) {
    if (err instanceof PublishError) {
      return json({ error: err.message, issues: err.errors }, { status: err.status });
    }
    return error(500, "publish failed");
  }
}

export async function OPTIONS() {
  return preflight();
}
