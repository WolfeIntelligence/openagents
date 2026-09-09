import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { isDbEnabled } from "@/lib/db/client";
import { publishPackage, PublishError } from "@/lib/publish";

const bodySchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      content: z.string(),
    })
  ),
});

export async function POST(req: NextRequest) {
  if (!isDbEnabled()) {
    return NextResponse.json({ error: "database not configured" }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.handle) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }

  try {
    const result = await publishPackage({
      userHandle: session.user.handle,
      files: parsed.data.files,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof PublishError) {
      return NextResponse.json({ error: err.message, issues: err.errors }, { status: err.status });
    }
    return NextResponse.json({ error: "publish failed" }, { status: 500 });
  }
}
