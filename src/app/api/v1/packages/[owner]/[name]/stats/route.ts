import { NextRequest } from "next/server";
import { getCatalog } from "@/lib/catalog";
import { downloadsBy, downloadsByDay, fillDailySeries } from "@/lib/analytics";
import { json, error, preflight } from "@/lib/api";

export const runtime = "nodejs";

const DEFAULT_DAYS = 30;
const MIN_DAYS = 1;
const MAX_DAYS = 365;

/** Parses `?days=`, defaulting to 30 and clamping to [1, 365] — a bogus or missing
 *  value degrades to the default rather than erroring, matching the rest of the
 *  `/api/v1` query-parsing convention (see `parseCatalogQuery`). */
function parseDays(request: NextRequest): number {
  const raw = request.nextUrl.searchParams.get("days");
  const parsed = raw !== null ? Number(raw) : NaN;
  const whole = Number.isFinite(parsed) ? Math.floor(parsed) : DEFAULT_DAYS;
  return Math.min(Math.max(whole, MIN_DAYS), MAX_DAYS);
}

// GET /api/v1/packages/[owner]/[name]/stats?days=30 — public, aggregate-only install
// analytics for one package: total downloads (the all-time `package_stats` counter),
// a dense daily series for the requested window, and by-version/by-runtime breakdowns
// over that same window. Backs the public sparkline on the package page and the seller
// dashboard. Cached for 5 minutes — this is aggregate, non-personal data that doesn't
// need to be fresher than that.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; name: string }> }
) {
  const { owner, name } = await params;
  const catalog = await getCatalog();
  const pkg = await catalog.get(owner, name);
  if (!pkg) {
    return error(404, `package not found: ${owner}/${name}`);
  }

  const days = parseDays(request);
  const [byDayRows, byVersion, byRuntime] = await Promise.all([
    downloadsByDay(owner, name, days),
    downloadsBy(owner, name, "version", days),
    downloadsBy(owner, name, "runtime", days),
  ]);

  return json(
    {
      downloads: {
        total: pkg.stats.downloads,
        byDay: fillDailySeries(byDayRows, days),
        byVersion,
        byRuntime,
      },
      stars: pkg.stats.stars,
      rating: {
        average: pkg.stats.ratingAverage ?? 0,
        count: pkg.stats.ratingCount ?? 0,
      },
    },
    { headers: { "Cache-Control": "public, max-age=300" } }
  );
}

export async function OPTIONS() {
  return preflight();
}
