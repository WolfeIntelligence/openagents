import { error, preflight } from "@/lib/api";

// GET /api/v1 — the bare prefix is not an endpoint; answer with the same JSON
// 404 the catch-all gives every other unmatched path (see /docs/api).
export async function GET() {
  return error(404, "not found; see /docs/api for the endpoint list");
}
export async function OPTIONS() {
  return preflight();
}
