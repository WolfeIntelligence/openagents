import { NextRequest } from "next/server";
import { getRequester } from "@/lib/requester";
import { error, json, preflight } from "@/lib/api";

export const runtime = "nodejs";

// Identifies the caller — session cookie or bearer token — for both the browser
// (to confirm sign-in state) and the CLI (`openagents whoami`, and to check a
// stored token still works before using it for something bigger).
export async function GET(req: NextRequest) {
  const requester = await getRequester(req);
  if (!requester) {
    return error(401, "unauthorized");
  }

  return json({
    id: requester.id,
    handle: requester.handle ?? null,
    name: requester.name ?? null,
    via: requester.via,
    scopes: requester.scopes,
  });
}

export async function OPTIONS() {
  return preflight();
}
