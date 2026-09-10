import { NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { publishPackage, PublishError } from "@/lib/publish";

export const runtime = "nodejs";

const bodySchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      content: z.string(),
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

  const session = await auth();
  if (!session?.user?.handle) {
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
      userHandle: session.user.handle,
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
