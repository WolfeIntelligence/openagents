import { test, expect, type Page } from "@playwright/test";

/**
 * Every page/route this workstream is responsible for smoke-testing: status
 * 200, some key text that proves the right thing rendered, no console errors,
 * and no failed network requests. Run against a zero-env production server
 * (see playwright.config.ts) — no sign-in, no DB, no network beyond
 * localhost.
 *
 * `/changelog` isn't owned by this workstream and may not exist yet (see
 * AGENTS.md task list) — it 404s until another stream lands the route, so
 * that one case skips rather than fails.
 */

interface SmokeCase {
  path: string;
  /** Text that must appear somewhere on the page (case-sensitive substring). */
  expectText?: string | RegExp;
  /** Skip entirely if the response isn't 2xx (used for /changelog, which may not exist yet). */
  optional?: boolean;
  /** Response is not HTML (XML/txt/image) — skip the console/request/HTML checks. */
  nonHtml?: boolean;
}

const CASES: SmokeCase[] = [
  { path: "/", expectText: "The open marketplace for agentic workflows" },
  { path: "/explore", expectText: "Explore" },
  { path: "/p/openagents/pr-reviewer", expectText: "Pull Request Reviewer" },
  { path: "/u/openagents", expectText: "openagents" },
  { path: "/tags", expectText: "Tags" },
  { path: "/collections", expectText: "Collections" },
  { path: "/docs", expectText: "Documentation" },
  { path: "/docs/api", expectText: "API" },
  { path: "/pricing", expectText: "Pricing" },
  { path: "/changelog", optional: true },
  { path: "/feed.xml", nonHtml: true },
  { path: "/sitemap.xml", nonHtml: true },
  { path: "/robots.txt", nonHtml: true },
  { path: "/opengraph-image", nonHtml: true },
  { path: "/p/openagents/pr-reviewer/opengraph-image", nonHtml: true },
];

for (const c of CASES) {
  test(`smoke: ${c.path}`, async ({ page, request }) => {
    if (c.optional) {
      const res = await request.get(c.path);
      test.skip(!res.ok(), `${c.path} does not exist yet (${res.status()})`);
    }

    if (c.nonHtml) {
      const res = await request.get(c.path);
      expect(res.status()).toBe(200);
      return;
    }

    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("requestfailed", (req) => {
      // Next.js prefetches every in-viewport <Link> as an RSC request
      // (`?_rsc=...`); when the test navigates on/closes the page before one
      // of those completes, Chromium reports it as `net::ERR_ABORTED`. That's
      // the browser cancelling its own speculative request, not a real
      // failure — see https://nextjs.org/docs/app/building-your-application/routing/linking-and-navigating#prefetching.
      if (req.failure()?.errorText === "net::ERR_ABORTED") return;
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
    });

    const response = await page.goto(c.path);
    expect(response?.status()).toBe(200);

    if (c.expectText) {
      await expect(page.locator("body")).toContainText(c.expectText);
    }

    expect(consoleErrors, `console errors on ${c.path}`).toEqual([]);
    expect(failedRequests, `failed requests on ${c.path}`).toEqual([]);
  });
}

test("each package page tab renders", async ({ page }) => {
  const tabs: { id: string; text: string | RegExp }[] = [
    { id: "readme", text: "PR Reviewer" },
    { id: "files", text: "WORKFLOW.md" },
    { id: "manifest", text: "schema" },
    { id: "versions", text: "1.2.0" },
  ];

  for (const tab of tabs) {
    const url = tab.id === "readme" ? "/p/openagents/pr-reviewer" : `/p/openagents/pr-reviewer?tab=${tab.id}`;
    await page.goto(url);
    await expect(page.getByRole("tab", { name: new RegExp(tab.id, "i") })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("body")).toContainText(tab.text);
  }
});

test("404 page renders for an unknown package", async ({ page }) => {
  const response = await page.goto("/p/openagents/does-not-exist");
  expect(response?.status()).toBe(404);
});

async function collectIssues(page: Page) {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  return consoleErrors;
}

test("home page has no console errors after interaction-free load", async ({ page }) => {
  const errors = await collectIssues(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});
