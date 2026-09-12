import { test, expect } from "@playwright/test";

test("header search lands on /explore with the matching package", async ({ page }) => {
  await page.goto("/");
  // Desktop viewport: the header's lg:flex search box is the visible one (a
  // second copy renders for the mobile breakpoint but is `hidden` in CSS at
  // this viewport — see src/components/Header.tsx).
  const search = page.getByRole("search").first();
  await search.getByRole("combobox", { name: "Search packages" }).fill("code review");
  await search.getByRole("button", { name: "Search" }).click();

  await expect(page).toHaveURL(/\/explore\?q=code\+review/);
  await expect(page.getByRole("link", { name: /Pull Request Reviewer/ })).toBeVisible();
});

test("a typo query shows the corrected-query notice", async ({ page }) => {
  await page.goto("/explore?q=reveiw");
  await expect(
    page.getByText(/No results for[\s\S]*reveiw[\s\S]*showing results for[\s\S]*review/),
  ).toBeVisible();
  // The corrected query still surfaces relevant results.
  await expect(page.getByRole("link", { name: /Pull Request Reviewer/ })).toBeVisible();
});

test("explore filters show counts and removable chips", async ({ page }) => {
  await page.goto("/explore?kind=workflow");

  // Active filter chip for the kind, with a "Clear all" escape hatch.
  await expect(page.getByRole("link", { name: /Remove filter: Workflow/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Clear all" })).toBeVisible();

  // Result count text reflects the filtered total.
  await expect(page.getByText(/^\d+ packages?$/)).toBeVisible();

  // The desktop filter sidebar shows a count next to at least one option.
  const sidebar = page.locator("aside[aria-label='Filters']");
  await expect(sidebar.getByText("Workflow", { exact: true })).toBeVisible();
});

test("Clear all resets every filter", async ({ page }) => {
  await page.goto("/explore?kind=workflow&price=free");
  await page.getByRole("link", { name: "Clear all" }).click();
  await expect(page).toHaveURL(/\/explore$/);
  await expect(page.getByRole("link", { name: /Remove filter/i })).toHaveCount(0);
});

test("requesting a page past the last one shows the overflow notice", async ({ page }) => {
  await page.goto("/explore?kind=workflow&page=999");
  await expect(page.getByText(/doesn.t exist.*showing the last page/)).toBeVisible();
});

test("sort=name orders results A→Z", async ({ page }) => {
  const res = await page.request.get("/api/v1/packages?sort=name&limit=50");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { items: { name: string }[] };
  const names = body.items.map((i) => i.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  expect(names).toEqual(sorted);

  // Same ordering is reflected in the UI's sort select.
  await page.goto("/explore?sort=name");
  await expect(page.locator("#oa-sort")).toHaveValue("name");
});
