# End-to-end tests (Playwright)

`e2e/` holds Playwright tests that run against a real, built, zero-env
production server (`next build` + `next start` — never `next dev`, never a
database). They cover pages, the `/api/v1/*` HTTP surface, the CLI
(`cli/bin/openagents.js`), mobile layout, and basic accessibility, all against
the on-disk seed catalog. No sign-in, no `DATABASE_URL`, no network beyond
`localhost`.

## Running locally

Playwright's `webServer` only **starts** `next start -p 4171`; it does not
build. Build once, then run the suite as many times as you like:

```sh
npm run build
npm run test:e2e            # first time: also run `npm run test:e2e:install`
```

`npm run test:e2e:install` downloads the Chromium browser Playwright drives
(`playwright install --with-deps chromium`) — a one-time setup step per
machine, same as CI's own install step.

Useful variants:

```sh
npx playwright test e2e/api.spec.ts      # one file
npx playwright test --project=chromium   # desktop only, skip the mobile project
npx playwright show-report                # open the last HTML report
```

## Pointing at a different server

Set `E2E_BASE_URL` to skip starting a local server entirely and run the same
suite against anything already running (a preview deploy, a manually-started
`next start` on another port):

```sh
E2E_BASE_URL=https://your-preview.vercel.app npx playwright test
```

## Layout

- `playwright.config.ts` — Chromium only, plus one mobile project
  (375×812, `e2e/mobile.spec.ts` only). `retries: 1` in CI, `trace:
  "on-first-retry"`.
- `e2e/smoke.spec.ts` — every top-level page/route 200s with the right text,
  no console errors, no failed requests.
- `e2e/search.spec.ts` — header search, typo tolerance, Explore filters/chips,
  pagination overflow, sort order.
- `e2e/package.spec.ts` — the package detail page's install box, Files tab,
  file viewer, versions tab, star button, report dialog, README table of
  contents.
- `e2e/mobile.spec.ts` — mobile nav, collapsed filters, no horizontal
  overflow.
- `e2e/api.spec.ts` — `/api/v1/*` (and `/api/checkout`) request/response
  shapes, headers, CORS, security headers.
- `e2e/cli.spec.ts` — shells out to `cli/bin/openagents.js` against the
  running server: `add`, `search --json`, `info --json`, `validate`, `init`.
- `e2e/a11y.spec.ts` — one `<h1>` per page, image `alt`, labeled form inputs,
  named buttons, the skip link.

## `test.fixme`s

A few tests are marked `test.fixme` because they document a real bug outside
this workstream's scope (owned by app code, not by these tests) rather than a
tooling issue — see the comment on each for the fix:

- `e2e/a11y.spec.ts` — `/collections`'s search input has no `<label>`/
  `aria-label` (unlike the identical pattern on `/tags`).
- `e2e/a11y.spec.ts` — the skip link doesn't move keyboard focus to
  `#main-content` (needs `tabIndex={-1}` on that element).
- `e2e/mobile.spec.ts` — a README with a wide GFM table (e.g.
  `openagents/pr-reviewer`) overflows the viewport horizontally on mobile
  (`.prose-oa table` has no `overflow-x-auto` wrapper).
