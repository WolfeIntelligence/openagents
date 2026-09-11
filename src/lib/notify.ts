// Notification hooks. Route handlers call these at the moments a person would
// want to hear about (a sale, a purchase, a report); the email workstream wires
// them to a provider. Every function is fire-and-forget and never throws, so a
// notification failure can never break the action that triggered it.
//
// Implemented by src/lib/email.ts (env-gated on RESEND_API_KEY); every lookup here
// (a buyer/seller/owner's address, an admin inbox, a package's title) is best-effort
// and skips silently on a miss — a notification is never worth failing, or even
// logging loudly over, the purchase/report/status-change that triggered it.

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { getCatalog } from "@/lib/catalog";
import { absoluteUrl, cliSpec } from "@/lib/site";
import { installCommand } from "@/lib/runtimes";
import { netRevenueCents } from "@/lib/stripe";
import {
  purchaseReceipt,
  saleNotice,
  reportNotice,
  statusNotice,
  sendEmail,
} from "@/lib/email";

export interface PurchaseNotification {
  purchaseId: string;
  buyerUserId: string;
  owner: string;
  name: string;
  amountCents: number;
  currency: string;
  receiptUrl?: string | null;
  /** "one-time" | "subscription" */
  kind: string;
}

export interface ReportNotification {
  reportId: string;
  owner: string;
  name: string;
  reason: string;
  details?: string | null;
}

export interface StatusNotification {
  owner: string;
  name: string;
  /** New package status, e.g. "live" after an admin approves or "unlisted" after a rejection. */
  status: string;
  message?: string | null;
}

/** A package's display title for an email subject/body, falling back to its bare
 *  name — best-effort against both the seed and DB catalogs, never throws. */
async function packageTitle(owner: string, name: string): Promise<string> {
  try {
    const catalog = await getCatalog();
    const pkg = await catalog.get(owner, name);
    return pkg?.manifest.title ?? name;
  } catch {
    return name;
  }
}

/** `users.email` for a user id, or null on any miss (no row, no email on file, no DB). */
async function emailForUserId(userId: string): Promise<{ email: string | null; name: string | null } | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const [row] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

/** `users.email` for a handle (a package owner), or null on any miss. */
async function emailForHandle(handle: string): Promise<{ email: string | null; name: string | null } | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const [row] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.handle, handle)).limit(1);
    return row ?? null;
  } catch {
    return null;
  }
}

/** Inbox for report notifications: `ADMIN_EMAIL` if set, else the first admin's
 *  email from `users` where `isAdmin`. Null when neither exists — a deployment
 *  with no configured admin has nowhere to send this, and that's fine. */
async function adminEmail(): Promise<string | null> {
  const explicit = process.env.ADMIN_EMAIL?.trim();
  if (explicit) return explicit;

  const db = getDb();
  if (!db) return null;
  try {
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.isAdmin, true)).limit(1);
    return row?.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Emails the buyer a receipt (with the install command and, when available, a link
 * to the Stripe-hosted receipt) and the seller a sale notice with their net amount.
 * Either side missing an email address (or a DB) just means that half is skipped —
 * a purchase is already recorded by the time this runs, so there's nothing here
 * worth failing over.
 */
export async function notifyPurchaseCompleted(n: PurchaseNotification): Promise<void> {
  try {
    const title = await packageTitle(n.owner, n.name);

    const buyer = await emailForUserId(n.buyerUserId);
    if (buyer?.email) {
      const content = purchaseReceipt({
        packageTitle: title,
        owner: n.owner,
        name: n.name,
        amountCents: n.amountCents,
        currency: n.currency,
        installCommand: installCommand(n.owner, n.name, undefined, cliSpec()),
        receiptUrl: n.receiptUrl,
      });
      await sendEmail({ to: buyer.email, ...content });
    }

    const seller = await emailForHandle(n.owner);
    if (seller?.email) {
      const content = saleNotice({
        packageTitle: title,
        owner: n.owner,
        name: n.name,
        netAmountCents: netRevenueCents(n.amountCents),
        currency: n.currency,
      });
      await sendEmail({ to: seller.email, ...content });
    }
  } catch {
    // Best-effort — see file header.
  }
}

/** Emails admins (see `adminEmail`) with a link to the moderation queue. */
export async function notifyReportCreated(n: ReportNotification): Promise<void> {
  try {
    const to = await adminEmail();
    if (!to) return;

    const content = reportNotice({
      owner: n.owner,
      name: n.name,
      reason: n.reason,
      details: n.details,
      adminUrl: absoluteUrl("/admin"),
    });
    await sendEmail({ to, ...content });
  } catch {
    // Best-effort — see file header.
  }
}

/** Emails the package's owner (looked up by handle) that its status changed. */
export async function notifyPackageStatusChanged(n: StatusNotification): Promise<void> {
  try {
    const owner = await emailForHandle(n.owner);
    if (!owner?.email) return;

    const content = statusNotice({
      owner: n.owner,
      name: n.name,
      status: n.status,
      message: n.message,
      packageUrl: absoluteUrl(`/p/${n.owner}/${n.name}`),
    });
    await sendEmail({ to: owner.email, ...content });
  } catch {
    // Best-effort — see file header.
  }
}
