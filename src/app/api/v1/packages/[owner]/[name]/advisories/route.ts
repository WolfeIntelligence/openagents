import { NextRequest } from "next/server";
import { getRequester } from "@/lib/requester";
import { isAdmin } from "@/lib/admin";
import { isDbEnabled } from "@/lib/db/client";
import { error, json, preflight } from "@/lib/api";
import { AdvisoryError, createAdvisory, listAdvisoriesForPackage, updateAdvisory } from "@/lib/advisories";

export const runtime = "nodejs";

// GET /api/v1/packages/[owner]/[name]/advisories — public.
// { items: Advisory[] } — active advisories first, newest first within each group.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;
  const items = await listAdvisoriesForPackage(owner, name);
  return json({ items });
}

// POST /api/v1/packages/[owner]/[name]/advisories — admin-only.
// { severity, title, body, affectedVersions?, fixedInVersion? } -> the created advisory.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;

  if (!isDbEnabled()) {
    return error(503, "advisories require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  if (!(await isAdmin(requester))) return error(403, "admin access required");

  const body: unknown = await request.json().catch(() => null);
  const { severity, title, body: advisoryBody, affectedVersions, fixedInVersion } = (body ?? {}) as {
    severity?: unknown;
    title?: unknown;
    body?: unknown;
    affectedVersions?: unknown;
    fixedInVersion?: unknown;
  };

  if (typeof severity !== "string" || typeof title !== "string" || typeof advisoryBody !== "string") {
    return error(400, `body must include "severity", "title", and "body" (all strings)`);
  }
  if (affectedVersions !== undefined && typeof affectedVersions !== "string") {
    return error(400, `"affectedVersions" must be a string`);
  }
  if (fixedInVersion !== undefined && typeof fixedInVersion !== "string") {
    return error(400, `"fixedInVersion" must be a string`);
  }

  try {
    const advisory = await createAdvisory({
      owner,
      name,
      severity,
      title,
      body: advisoryBody,
      affectedVersions,
      fixedInVersion,
      createdByUserId: requester.id,
    });
    return json(advisory, { status: 201 });
  } catch (err) {
    if (err instanceof AdvisoryError) return error(err.status, err.message);
    console.error(`[api] ${new URL(request.url).pathname}:`, err);
    return error(503, "temporarily unavailable; try again shortly");
  }
}

// PATCH /api/v1/packages/[owner]/[name]/advisories — admin-only.
// { id, withdrawn?, severity?, title?, body?, affectedVersions?, fixedInVersion? } -> the updated advisory.
// The id is a body field rather than a URL segment — this route file is the
// single owner of both admin-write verbs (see AGENTS.md/workstream Z2 scope).
export async function PATCH(request: NextRequest) {
  if (!isDbEnabled()) {
    return error(503, "advisories require a database; none is configured on this deployment");
  }

  const requester = await getRequester(request);
  if (!requester) return error(401, "sign in required");
  if (!(await isAdmin(requester))) return error(403, "admin access required");

  const body: unknown = await request.json().catch(() => null);
  const { id, withdrawn, severity, title, body: advisoryBody, affectedVersions, fixedInVersion } = (body ??
    {}) as {
    id?: unknown;
    withdrawn?: unknown;
    severity?: unknown;
    title?: unknown;
    body?: unknown;
    affectedVersions?: unknown;
    fixedInVersion?: unknown;
  };

  if (typeof id !== "string" || !id) {
    return error(400, `body must include "id"`);
  }
  if (withdrawn !== undefined && typeof withdrawn !== "boolean") {
    return error(400, `"withdrawn" must be a boolean`);
  }
  if (severity !== undefined && typeof severity !== "string") {
    return error(400, `"severity" must be a string`);
  }
  if (title !== undefined && typeof title !== "string") {
    return error(400, `"title" must be a string`);
  }
  if (advisoryBody !== undefined && typeof advisoryBody !== "string") {
    return error(400, `"body" must be a string`);
  }
  if (affectedVersions !== undefined && affectedVersions !== null && typeof affectedVersions !== "string") {
    return error(400, `"affectedVersions" must be a string or null`);
  }
  if (fixedInVersion !== undefined && fixedInVersion !== null && typeof fixedInVersion !== "string") {
    return error(400, `"fixedInVersion" must be a string or null`);
  }

  try {
    const advisory = await updateAdvisory(id, {
      withdrawn,
      severity,
      title,
      body: advisoryBody,
      affectedVersions,
      fixedInVersion,
    });
    return json(advisory);
  } catch (err) {
    if (err instanceof AdvisoryError) return error(err.status, err.message);
    console.error(`[api] ${new URL(request.url).pathname}:`, err);
    return error(503, "temporarily unavailable; try again shortly");
  }
}

export async function OPTIONS() {
  return preflight();
}
