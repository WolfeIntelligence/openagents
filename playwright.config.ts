import { defineConfig, devices } from "@playwright/test";

// End-to-end tests against a production (`next build` + `next start`) server,
// run with zero environment variables so they exercise exactly the
// zero-config deploy target described in src/content/docs/self-hosting.md.
//
// The build itself is NOT run by this config — Playwright's `webServer` only
// *starts* the server; it assumes `.next/` already exists. In CI, the `e2e`
// job runs `npx next build` before `npx playwright test` (see
// .github/workflows/ci.yml). Locally, run `npm run build` once, then
// `npm run test:e2e` (or `npx playwright test`) as many times as you like.
//
// Point tests at an already-running server elsewhere (e.g. a preview deploy)
// by setting E2E_BASE_URL — this also skips starting a local `next start`.
const PORT = 4171;
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",

  use: {
    baseURL,
    trace: "on-first-retry",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 } },
      testMatch: /mobile\.spec\.ts/,
    },
  ],

  // Only started when no external E2E_BASE_URL was given. Requires a build to
  // already exist (`npx next build` / `npm run build`) — this just starts the
  // production server; it does not build.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npx next start -p ${PORT}`,
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
