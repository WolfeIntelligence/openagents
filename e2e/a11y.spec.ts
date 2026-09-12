import { test, expect } from "@playwright/test";

// Lightweight, dependency-free accessibility checks (no axe-core) across the
// same page list smoke.spec.ts covers. `/changelog` is skipped the same way —
// it isn't owned by this workstream and may 404 until another stream lands it.
const PAGES = [
  "/",
  "/explore",
  "/p/openagents/pr-reviewer",
  "/u/openagents",
  "/tags",
  "/collections",
  "/docs",
  "/docs/api",
  "/pricing",
];

for (const path of PAGES) {
  test(`exactly one h1 on ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("h1")).toHaveCount(1);
  });

  test(`every image has alt text on ${path}`, async ({ page }) => {
    await page.goto(path);
    const images = page.locator("img");
    const count = await images.count();
    for (let i = 0; i < count; i++) {
      const alt = await images.nth(i).getAttribute("alt");
      expect(alt, `image #${i} on ${path} has no alt attribute`).not.toBeNull();
    }
  });

  test(`every button has an accessible name on ${path}`, async ({ page }) => {
    await page.goto(path);
    const buttons = page.locator("button");
    const count = await buttons.count();
    for (let i = 0; i < count; i++) {
      const button = buttons.nth(i);
      const name = await button.evaluate((el) => {
        const aria = el.getAttribute("aria-label");
        if (aria) return aria.trim();
        return (el.textContent ?? "").trim();
      });
      expect(name, `button #${i} on ${path} has no accessible name`).not.toBe("");
    }
  });
}

// Form inputs need an explicit `aria-label` or an associated `<label>` — a
// `placeholder` alone doesn't count (it disappears once the user types, and
// isn't a reliable accessible name for every assistive technology), even
// though browsers happen to fall back to it when computing an accessible
// name. Checked on every page except /collections, which currently fails
// this — see the dedicated `test.fixme` below and "Needs change elsewhere"
// in the workstream report.
const PAGES_WITH_LABELED_INPUTS = PAGES.filter((p) => p !== "/collections");

for (const path of PAGES_WITH_LABELED_INPUTS) {
  test(`every form input has an explicit label on ${path}`, async ({ page }) => {
    await page.goto(path);
    const inputs = page.locator("input:not([type=hidden]), textarea, select");
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const hasLabel = await input.evaluate((el) => {
        if (el.getAttribute("aria-label")) return true;
        if (el.getAttribute("aria-labelledby")) return true;
        const id = el.getAttribute("id");
        if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) return true;
        return Boolean(el.closest("label"));
      });
      expect(hasLabel, `input #${i} on ${path} has no aria-label or associated <label>`).toBe(true);
    }
  });
}

test(
  "every form input has an explicit label on /collections",
  async ({ page }) => {
    // Needs change elsewhere: src/app/collections/page.tsx's `PageShell`
    // renders `<input type="search" name="q" placeholder="Search collections…">`
    // with no `<label>` and no `aria-label` — unlike the equivalent filter
    // input on /tags (src/app/tags/page.tsx), which wraps its input in a
    // proper `sr-only` `<label htmlFor="oa-tags-q">`. Browsers do compute an
    // accessible name for the /collections input from its placeholder as a
    // last resort, so it isn't invisible to every screen reader, but that's
    // a well-known anti-pattern (the label disappears once the user types,
    // and coverage across assistive tech is inconsistent) — the fix is to
    // add the same sr-only `<label>` pattern /tags already uses.
    await page.goto("/collections");
    const input = page.locator('input[placeholder="Search collections…"]');
    const hasLabel = await input.evaluate((el) => {
      if (el.getAttribute("aria-label")) return true;
      if (el.getAttribute("aria-labelledby")) return true;
      const id = el.getAttribute("id");
      if (id && document.querySelector(`label[for="${CSS.escape(id)}"]`)) return true;
      return Boolean(el.closest("label"));
    });
    expect(hasLabel).toBe(true);
  },
);

test("the skip link exists and lets keyboard users jump past the header", async ({ page }) => {
  await page.goto("/");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeAttached();

  await page.keyboard.press("Tab"); // first tab stop on a fresh load
  await expect(skipLink).toBeFocused();
});

test(
  "activating the skip link moves focus to #main-content",
  async ({ page }) => {
    // Needs change elsewhere: `<main id="main-content">` in src/app/layout.tsx
    // has no `tabIndex={-1}`, so activating the `href="#main-content"` skip
    // link scrolls to it (the URL hash changes) but does NOT move keyboard
    // focus there — focus lands on <body> instead. That defeats the point of
    // a skip link for a keyboard/screen-reader user, who still has to tab
    // through the whole header to reach the first focusable thing in main.
    // Fix: add `tabIndex={-1}` to that <main> element (WCAG technique G1 /
    // SCR28's standard pattern).
    await page.goto("/");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  },
);
