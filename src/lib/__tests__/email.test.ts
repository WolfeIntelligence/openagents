import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { purchaseReceipt, saleNotice, reportNotice, statusNotice, sendEmail } from "../email";

describe("purchaseReceipt", () => {
  test("includes the package, price, and install command", () => {
    const content = purchaseReceipt({
      packageTitle: "PR Reviewer",
      owner: "openagents",
      name: "pr-reviewer",
      amountCents: 500,
      currency: "usd",
      installCommand: "npx openagents add openagents/pr-reviewer",
      receiptUrl: null,
    });

    assert.equal(content.subject, "Your receipt for openagents/pr-reviewer");
    assert.match(content.text, /PR Reviewer/);
    assert.match(content.text, /\$5\.00/);
    assert.match(content.text, /npx openagents add openagents\/pr-reviewer/);
    assert.match(content.html, /PR Reviewer/);
  });

  test("includes a receipt link only when one is provided", () => {
    const withReceipt = purchaseReceipt({
      packageTitle: "PR Reviewer",
      owner: "openagents",
      name: "pr-reviewer",
      amountCents: 500,
      currency: "usd",
      installCommand: "npx openagents add openagents/pr-reviewer",
      receiptUrl: "https://pay.stripe.com/receipts/abc",
    });
    assert.match(withReceipt.text, /https:\/\/pay\.stripe\.com\/receipts\/abc/);

    const withoutReceipt = purchaseReceipt({
      packageTitle: "PR Reviewer",
      owner: "openagents",
      name: "pr-reviewer",
      amountCents: 500,
      currency: "usd",
      installCommand: "npx openagents add openagents/pr-reviewer",
      receiptUrl: undefined,
    });
    assert.doesNotMatch(withoutReceipt.text, /receipt/i);
  });
});

describe("saleNotice", () => {
  test("reports the net amount, not the gross", () => {
    const content = saleNotice({
      packageTitle: "PR Reviewer",
      owner: "openagents",
      name: "pr-reviewer",
      netAmountCents: 450,
      currency: "usd",
    });

    assert.equal(content.subject, "You made a sale: openagents/pr-reviewer");
    assert.match(content.text, /\$4\.50/);
    assert.doesNotMatch(content.text, /\$5\.00/);
  });
});

describe("reportNotice", () => {
  test("includes the reason and admin link, details only when present", () => {
    const withDetails = reportNotice({
      owner: "openagents",
      name: "pr-reviewer",
      reason: "malware",
      details: "downloads a suspicious binary",
      adminUrl: "https://openagents-nu.vercel.app/admin",
    });
    assert.match(withDetails.text, /malware/);
    assert.match(withDetails.text, /downloads a suspicious binary/);
    assert.match(withDetails.text, /https:\/\/openagents-nu\.vercel\.app\/admin/);

    const withoutDetails = reportNotice({
      owner: "openagents",
      name: "pr-reviewer",
      reason: "spam",
      details: null,
      adminUrl: "https://openagents-nu.vercel.app/admin",
    });
    assert.doesNotMatch(withoutDetails.text, /Details:/);
  });
});

describe("statusNotice", () => {
  test("includes the new status and package link, message only when present", () => {
    const withMessage = statusNotice({
      owner: "openagents",
      name: "pr-reviewer",
      status: "unlisted",
      message: "violates the license policy",
      packageUrl: "https://openagents-nu.vercel.app/p/openagents/pr-reviewer",
    });
    assert.match(withMessage.text, /unlisted/);
    assert.match(withMessage.text, /violates the license policy/);

    const withoutMessage = statusNotice({
      owner: "openagents",
      name: "pr-reviewer",
      status: "live",
      message: undefined,
      packageUrl: "https://openagents-nu.vercel.app/p/openagents/pr-reviewer",
    });
    assert.doesNotMatch(withoutMessage.text, /Note:/);
  });
});

describe("sendEmail", () => {
  test("no-ops without RESEND_API_KEY, and never throws", async () => {
    const original = process.env.RESEND_API_KEY;
    try {
      delete process.env.RESEND_API_KEY;
      const result = await sendEmail({ to: "a@example.com", subject: "hi", text: "hi" });
      assert.deepEqual(result, { sent: false, reason: "RESEND_API_KEY not configured" });
    } finally {
      if (original === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = original;
    }
  });
});
