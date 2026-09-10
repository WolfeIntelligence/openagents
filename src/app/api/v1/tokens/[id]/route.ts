import { NextRequest } from "next/server";
import { getRequester } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, preflight, withCors } from "@/lib/api";
import { revokeToken, TokenError } from "@/lib/tokens";

export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isDbEnabled()) {
    return error(503, "database not configured");
  }

  const requester = await getRequester(req);
  if (!requester) {
    return error(401, "unauthorized");
  }

  const { id } = await params;

  try {
    const revoked = await revokeToken(requester.id, id);
    if (!revoked) {
      return error(404, "token not found");
    }
    return withCors(new Response(null, { status: 204 }));
  } catch (err) {
    if (err instanceof TokenError) {
      return error(err.status, err.message);
    }
    return error(500, "failed to revoke token");
  }
}

export async function OPTIONS() {
  return preflight();
}
