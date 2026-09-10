import { json, preflight } from "@/lib/api";
// Bundled at build time (resolveJsonModule) rather than read from disk at request
// time, so this route works the same whether or not `public/` file tracing picked
// up the file for a given deploy target — see G-O7 in docs/AUDIT-2026-09.md.
import spec from "../../../../../public/openapi.json";

export const runtime = "nodejs";
// The spec is static per-deploy (it ships in the build, not read from a database),
// so let Next cache this route's output like any other static asset.
export const dynamic = "force-static";

// GET /api/v1/openapi — the OpenAPI 3.1 document for every /api/v1 (plus
// checkout/webhook/connect) route. Also served as a plain static file at
// /openapi.json; this route exists so clients can discover it under /api/v1
// without knowing the static-asset path.
export async function GET() {
  return json(spec);
}

export async function OPTIONS() {
  return preflight();
}
