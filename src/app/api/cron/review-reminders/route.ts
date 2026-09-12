import { and, eq, lt } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { packages, rateLimits, users } from "@/lib/db/schema";
import { requireCronAuth, shouldSendReviewReminder } from "@/lib/cron";
import { sendEmail } from "@/lib/email";
import { absoluteUrl } from "@/lib/site";

export const runtime = "nodejs";

// GET /api/cron/review-reminders — daily at 09:00 UTC (see vercel.json). Emails
// the admin inbox, at most once a day, when any package has sat "pending" for
// more than two days — so a slow review queue doesn't go unnoticed.
//
// "At most once a day" is tracked as a `rate_limits` row keyed
// `cron:review-reminders` rather than a dedicated table: this cron has no
// natural per-request identity to key a rate limit on, just a single "did we
// already send today" fact, so one row's `windowStart` (repurposed here as
// "last sent at") does the whole job without a migration for what's really a
// single timestamp. See `shouldSendReviewReminder` in src/lib/cron.ts for the
// actual throttle decision (unit-tested there without a database).
const REMINDER_KEY = "cron:review-reminders";
const PENDING_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;

/** `ADMIN_EMAIL` if set, else the first admin's email on file. This mirrors the
 *  private `adminEmail()` helper in src/lib/notify.ts in miniature; that module
 *  is outside this workstream's owned files, so this stays local rather than
 *  exporting from it. */
async function adminInbox(db: NonNullable<ReturnType<typeof getDb>>): Promise<string | null> {
  const explicit = process.env.ADMIN_EMAIL?.trim();
  if (explicit) return explicit;
  try {
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.isAdmin, true)).limit(1);
    return row?.email ?? null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const db = getDb();
  if (!db) return Response.json({ ok: true, pending: 0, sent: false, reason: "no database configured" });

  try {
    const cutoff = new Date(Date.now() - PENDING_THRESHOLD_MS);
    const pending = await db
      .select({ owner: packages.owner, name: packages.name, title: packages.title, createdAt: packages.createdAt })
      .from(packages)
      .where(and(eq(packages.status, "pending"), lt(packages.createdAt, cutoff)));

    if (pending.length === 0) {
      return Response.json({ ok: true, pending: 0, sent: false });
    }

    const [throttle] = await db.select().from(rateLimits).where(eq(rateLimits.key, REMINDER_KEY)).limit(1);
    if (!shouldSendReviewReminder(throttle?.windowStart ?? null)) {
      return Response.json({
        ok: true,
        pending: pending.length,
        sent: false,
        reason: "already sent within the last 23h",
      });
    }

    const to = await adminInbox(db);
    if (!to) {
      return Response.json({ ok: true, pending: pending.length, sent: false, reason: "no admin inbox configured" });
    }

    const plural = pending.length === 1 ? "" : "s";
    const lines = pending
      .map((p) => `- ${p.owner}/${p.name} (${p.title}) — pending since ${p.createdAt.toISOString().slice(0, 10)}`)
      .join("\n");
    const text = [
      `${pending.length} package${plural} ${pending.length === 1 ? "has" : "have"} been awaiting review for more than 2 days:`,
      lines,
      `Review them: ${absoluteUrl("/admin")}`,
    ].join("\n\n");

    const result = await sendEmail({ to, subject: `${pending.length} package${plural} awaiting review`, text });

    // Record the send regardless of provider outcome — a failed send (e.g. no
    // RESEND_API_KEY in this zero-env deployment) shouldn't make the next run
    // retry immediately; like a successful send, it tries again tomorrow.
    await db
      .insert(rateLimits)
      .values({ key: REMINDER_KEY, count: 1, windowStart: new Date() })
      .onConflictDoUpdate({ target: rateLimits.key, set: { count: 1, windowStart: new Date() } });

    return Response.json({ ok: true, pending: pending.length, sent: result.sent });
  } catch (err) {
    console.error("[cron/review-reminders]", err);
    return Response.json({ ok: false, error: "internal error" }, { status: 500 });
  }
}
