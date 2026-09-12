import { requireCronAuth } from "@/lib/cron";
import { rollupDownloads } from "@/lib/rollups";

export const runtime = "nodejs";

// GET /api/cron/rollup-downloads — daily at 02:15 UTC (see vercel.json). Vercel
// Cron calls this with `Authorization: Bearer ${CRON_SECRET}`; see
// requireCronAuth. Not an `/api/v1/*` route (no browser CORS surface — Vercel
// Cron calls it server-to-server), so it skips the json/error/preflight helpers
// those routes use.
//
// Rolls every `download_events` row older than today into `download_rollups`,
// then prunes raw events past the retention window. Idempotent/re-runnable —
// see rollupDownloads's doc comment in src/lib/rollups.ts.
export async function GET(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    const stats = await rollupDownloads();
    return Response.json({ ok: true, ...stats });
  } catch (err) {
    console.error("[cron/rollup-downloads]", err);
    return Response.json({ ok: false, error: "internal error" }, { status: 500 });
  }
}
