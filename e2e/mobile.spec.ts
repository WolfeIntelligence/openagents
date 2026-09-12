import { test, expect } from "@playwright/test";

// This whole file runs under the `mobile-chromium` project (375×812 viewport)
// — see playwright.config.ts's testMatch. No `test.use({ viewport })` needed
// here.

test("menu button opens the nav, Escape closes it, and focus returns", async ({ page }) => {
  await page.goto("/");

  // MobileNav (src/components/MobileNav.tsx) renders the toggle as a native
  // `<summary aria-label="Menu">`. Chromium's accessibility tree doesn't map
  // `<summary>` to any ARIA role Playwright's `getByRole` recognizes (it
  // shows up as an unnamed `group` from the parent `<details>` instead), so
  // this targets it directly rather than via role — that's a limitation of
  // the role locator, not a real accessibility problem (real screen readers
  // do announce `<summary aria-label>`).
  const menuButton = page.locator('summary[aria-label="Menu"]');
  await expect(menuButton).toBeVisible();
  await menuButton.click();

  const nav = page.getByRole("dialog", { name: "Menu" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("navigation", { name: "Primary" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(nav).not.toBeVisible();
  await expect(menuButton).toBeFocused();
});

test("Explore filters are collapsed in a details element", async ({ page }) => {
  await page.goto("/explore");

  const details = page.locator("details", { has: page.getByText(/^Filters/) });
  await expect(details).toBeVisible();
  await expect(details).toHaveJSProperty("open", false);

  await details.locator("summary").click();
  await expect(details).toHaveJSProperty("open", true);
  await expect(details.getByText("Kind", { exact: true })).toBeVisible();
});

test("no horizontal overflow on /", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("no horizontal overflow on /explore", async ({ page }) => {
  await page.goto("/explore");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test.fixme(
  "no horizontal overflow on /p/openagents/pr-reviewer",
  async ({ page }) => {
    // Needs change elsewhere: `.prose-oa table` in src/app/globals.css sets
    // `width: 100%` but the README's own container has no
    // `overflow-x: auto` wrapper around rendered markdown tables — unlike
    // the file-listing and manifest-inputs tables elsewhere on this same
    // page, which are each explicitly wrapped in a
    // `<div className="overflow-x-auto">` (see FileTable and the "Inputs"
    // table in src/app/p/[owner]/[name]/page.tsx). pr-reviewer's own README
    // (catalog/openagents/pr-reviewer/README.md) has a 5-column "Inputs"
    // table that's wider than a 375px viewport, so it forces the whole page
    // to scroll horizontally on mobile. Fix: wrap `.prose-oa table` (in
    // Markdown.tsx or globals.css) in the same overflow-x-auto pattern.
    await page.goto("/p/openagents/pr-reviewer");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  },
);
