import { NextRequest } from "next/server";
import { z } from "zod";
import { getRequester } from "@/lib/requester";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { RATE_LIMITS, withRateLimit } from "@/lib/ratelimit";
import { createToken, listTokens, TokenError, TOKEN_SCOPES } from "@/lib/tokens";

export const runtime = "nodejs";

// Minting a token has to prove you're a human at the keyboard with a browser session —
// a token can never be used to create another token, or a leaked token could mint
// itself an unlimited supply of siblings after being revoked once discovered.

const bodySchema = z.object({
  name: z.string().min(1).max(64),
  scopes: z.array(z.enum(TOKEN_SCOPES)).optional(),
});

export async function GET(req: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "database not configured");
  }

  const requester = await getRequester(req);
  if (!requester) {
    return error(401, "unauthorized");
  }

  const items = await listTokens(requester.id);
  return json({ items });
}

export async function POST(req: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "database not configured");
  }

  // Session only — checked before rate limiting so a bearer-token caller gets a
  // clear 401 rather than burning its IP's budget on a request that was never
  // going to succeed.
  const requester = await getRequester(req);
  if (!requester) {
    return error(401, "unauthorized");
  }
  if (requester.via !== "session") {
    return error(403, "a token cannot be used to create another token; sign in with a browser session");
  }

  const limited = await withRateLimit(req, "tokens-create", {
    ...RATE_LIMITS.tokensCreate,
    key: `tokens-create:${requester.id}`,
  });
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return json(
      { error: "invalid body", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 }
    );
  }

  try {
    const created = await createToken({
      userId: requester.id,
      name: parsed.data.name,
      scopes: parsed.data.scopes,
    });
    return json(created, { status: 201 });
  } catch (err) {
    if (err instanceof TokenError) {
      return error(err.status, err.message);
    }
    return error(500, "failed to create token");
  }
}

export async function OPTIONS() {
  return preflight();
}
