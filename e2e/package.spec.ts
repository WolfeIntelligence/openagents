import { test, expect } from "@playwright/test";

const PKG_PATH = "/p/openagents/pr-reviewer";

test("install box runtime tabs change the command, and a copy button exists", async ({ page }) => {
  await page.goto(PKG_PATH);

  const installBox = page.getByRole("tablist", { name: "Install command per runtime" });
  const command = page.locator("code").filter({ hasText: "openagents" }).first();

  await expect(command).toContainText("claude-code");

  await installBox.getByRole("tab", { name: "Cursor" }).click();
  await expect(command).toContainText("cursor");
  await expect(installBox.getByRole("tab", { name: "Cursor" })).toHaveAttribute("aria-selected", "true");

  // Copy button next to the install command.
  await expect(page.getByRole("button", { name: /^Copy$/ }).first()).toBeVisible();
});

test("Files tab folder groups expand and collapse", async ({ page }) => {
  await page.goto(`${PKG_PATH}?tab=files`);

  const folder = page.locator("details", { hasText: "rules/" });
  await expect(folder).toBeVisible();
  await expect(folder).toHaveJSProperty("open", true); // G-C4: open by default

  await folder.locator("summary").click();
  await expect(folder).toHaveJSProperty("open", false);

  await folder.locator("summary").click();
  await expect(folder).toHaveJSProperty("open", true);

  // Root-level files (openagent.yaml, README.md) render ungrouped.
  await expect(page.getByRole("link", { name: "openagent.yaml" })).toBeVisible();
});

test("file viewer renders line numbers", async ({ page }) => {
  await page.goto(`${PKG_PATH}/files/WORKFLOW.md`);
  const table = page.locator("table.w-full.border-collapse");
  await expect(table).toBeVisible();
  // First line's gutter cell.
  await expect(table.locator("tr").first().locator("td").first()).toHaveText("1");
});

test("versions tab has a download link", async ({ page }) => {
  await page.goto(`${PKG_PATH}?tab=versions`);
  // "v1.2.0" also appears in the page header (current-version badge), so
  // scope to the version list item itself rather than matching by text alone.
  const versionEntry = page.locator("li", { hasText: "Download" });
  await expect(versionEntry).toContainText("v1.2.0");
  const downloadLink = versionEntry.getByRole("link", { name: "Download" });
  await expect(downloadLink).toBeVisible();
  await expect(downloadLink).toHaveAttribute(
    "href",
    "/api/v1/packages/openagents/pr-reviewer/versions/1.2.0/download",
  );
});

test("star button behaviour when signed out", async ({ page }) => {
  await page.goto(PKG_PATH);
  const starButton = page.getByRole("button", { name: /^Star$/ });
  await expect(starButton).toBeVisible();
  await starButton.click();

  // Current behaviour on a zero-env deployment (no DATABASE_URL): starring is
  // disabled at the database level, and that check runs before the
  // signed-out check (see StarButton.tsx's handleClick) — so the button
  // surfaces an inline note rather than redirecting to /signin. This is not
  // a bug (starring genuinely can't work without a database here); see the
  // workstream report's "Needs change elsewhere" for the discrepancy against
  // the originally-assumed sign-in-redirect behaviour on a deployment where
  // auth exists but the DB doesn't.
  await expect(page.getByText(/needs a database/i)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(PKG_PATH.replace(/\//g, "\\/")));
});

test("report button opens a dialog", async ({ page }) => {
  await page.goto(PKG_PATH);
  await page.getByRole("button", { name: "Report" }).click();

  const dialog = page.getByRole("dialog", { name: /Report openagents\/pr-reviewer/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Reason")).toBeVisible();
  await expect(dialog.getByLabel(/Details/)).toBeVisible();

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).not.toBeVisible();
});

test("README table of contents links jump to the right heading", async ({ page }) => {
  await page.goto(PKG_PATH);
  const toc = page.getByRole("navigation", { name: "Table of contents" });
  await expect(toc).toBeVisible();

  await toc.getByRole("link", { name: "When to use" }).click();
  await expect(page).toHaveURL(/#when-to-use$/);
  await expect(page.locator("#when-to-use")).toBeVisible();
});
