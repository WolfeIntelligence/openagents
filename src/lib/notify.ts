// Notification hooks. Route handlers call these at the moments a person would
// want to hear about (a sale, a purchase, a report); the email workstream wires
// them to a provider. Every function is fire-and-forget and never throws, so a
// notification failure can never break the action that triggered it.
//
// Implemented by src/lib/email.ts (env-gated on RESEND_API_KEY); until then these
// are no-ops.

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function notifyPurchaseCompleted(_n: PurchaseNotification): Promise<void> {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function notifyReportCreated(_n: ReportNotification): Promise<void> {}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function notifyPackageStatusChanged(_n: StatusNotification): Promise<void> {}
