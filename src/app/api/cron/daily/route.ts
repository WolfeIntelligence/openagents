import { requireCronAuth } from "@/lib/cron";
import { GET as rollupDownloads } from "../rollup-downloads/route";
import { GET as cleanup } from "../cleanup/route";
import { GET as reviewReminders } from "../review-reminders/route";

export const runtime = "nodejs";

// GET /api/cron/daily — runs every scheduled job once, in order.
//
// Vercel's Hobby plan allows two cron jobs at most, each firing no more than once
// a day, and rejects a deployment whose vercel.json asks for more. One daily entry
// that fans out to the individual jobs keeps the schedule within that limit while
// the per-job routes stay callable on their own (manually, or from a paid plan's
// finer-grained schedule). Each job's result is reported under its own key; one
// job failing does not stop the others.
export async function GET(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const jobs: [string, (req: Request) => Promise<Response>][] = [
    ["rollupDownloads", rollupDownloads],
    ["cleanup", cleanup],
    ["reviewReminders", reviewReminders],
  ];

  const results: Record<string, unknown> = {};
  let ok = true;
  for (const [name, job] of jobs) {
    try {
      const res = await job(new Request(request.url, { headers: request.headers }));
      const body = await res.json().catch(() => ({ ok: res.ok }));
      results[name] = body;
      if (!res.ok) ok = false;
    } catch (err) {
      console.error(`[cron/daily] ${name} failed`, err);
      results[name] = { ok: false, error: "internal error" };
      ok = false;
    }
  }

  return Response.json({ ok, ...results }, { status: ok ? 200 : 500 });
}
