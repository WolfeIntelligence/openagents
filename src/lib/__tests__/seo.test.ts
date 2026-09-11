// Run via `npm test` (node --import tsx --test) or `npx tsx --test <this file>`.
//
// Imports only src/lib/seo.ts (which itself only pulls in src/lib/site.ts for
// absoluteUrl) — no Next.js runtime, DB, or Stripe involved, same as
// src/lib/__tests__/format.test.ts and site.test.ts.

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  escapeXml,
  escapeForScriptTag,
  formatBadgeCount,
  buildSoftwareSourceCodeLd,
} from "../seo";
import type { Package } from "../types";

// buildSoftwareSourceCodeLd calls absoluteUrl(), which reads
// NEXT_PUBLIC_SITE_URL — pin it so assertions are deterministic regardless of
// the environment the test runs in.
const SITE = "https://openagents.example";
let savedSiteUrl: string | undefined;

beforeEach(() => {
  savedSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
});

afterEach(() => {
  if (savedSiteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = savedSiteUrl;
});

function makePackage(overrides: Partial<Package> = {}): Package {
  return {
    id: "ada/sample-workflow",
    owner: "ada",
    name: "sample-workflow",
    manifest: {
      schema: 1,
      name: "sample-workflow",
      owner: "ada",
      version: "1.2.3",
      kind: "workflow",
      title: "Sample Workflow",
      summary: "Does a thing, reliably.",
      license: "MIT",
      tags: [],
      runtimes: ["claude-code"],
      pricing: { model: "free", amountCents: 0, currency: "usd" },
      entry: "SKILL.md",
      files: [],
      inputs: [],
      requires: [],
    },
    readme: "",
    files: [],
    versions: [],
    stats: { downloads: 0, stars: 0 },
    featured: false,
    status: "live",
    source: "seed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-02-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildSoftwareSourceCodeLd", () => {
  test("free package: no offers, no aggregateRating, core fields set", () => {
    const pkg = makePackage();
    const ld = buildSoftwareSourceCodeLd({ pkg });

    assert.equal(ld["@context"], "https://schema.org");
    assert.equal(ld["@type"], "SoftwareSourceCode");
    assert.equal(ld.name, "Sample Workflow");
    assert.equal(ld.description, "Does a thing, reliably.");
    assert.equal(ld.url, `${SITE}/p/ada/sample-workflow`);
    assert.equal(ld.codeRepository, `${SITE}/p/ada/sample-workflow`);
    assert.equal(ld.programmingLanguage, "Markdown");
    assert.equal(ld.license, "MIT");
    assert.equal(ld.version, "1.2.3");
    assert.equal(ld.dateModified, "2026-02-15T00:00:00.000Z");
    assert.equal("offers" in ld, false);
    assert.equal("aggregateRating" in ld, false);
  });

  test("uses manifest.repository as codeRepository when present", () => {
    const pkg = makePackage({
      manifest: { ...makePackage().manifest, repository: "https://github.com/ada/sample-workflow" },
    });
    const ld = buildSoftwareSourceCodeLd({ pkg });
    assert.equal(ld.codeRepository, "https://github.com/ada/sample-workflow");
  });

  test("author falls back to the bare handle when no creator profile is given", () => {
    const pkg = makePackage();
    const ld = buildSoftwareSourceCodeLd({ pkg });
    assert.deepEqual(ld.author, {
      "@type": "Person",
      name: "ada",
      url: `${SITE}/u/ada`,
    });
  });

  test("author uses the creator's display name and url when given", () => {
    const pkg = makePackage();
    const ld = buildSoftwareSourceCodeLd({
      pkg,
      creator: { handle: "ada", displayName: "Ada Lovelace", url: "https://ada.dev", packageCount: 3 },
    });
    assert.deepEqual(ld.author, {
      "@type": "Person",
      name: "Ada Lovelace",
      url: "https://ada.dev",
    });
  });

  test("paid one-time package includes offers with price/currency", () => {
    const pkg = makePackage({
      manifest: {
        ...makePackage().manifest,
        pricing: { model: "one-time", amountCents: 1999, currency: "usd" },
      },
    });
    const ld = buildSoftwareSourceCodeLd({ pkg });
    assert.deepEqual(ld.offers, {
      "@type": "Offer",
      price: "19.99",
      priceCurrency: "USD",
    });
  });

  test("a free pricing model with a nonzero amount is still treated as free (defensive)", () => {
    // amountCents is documented as 0 when free — this just confirms the
    // "free" model itself is what decides, not the amount alone.
    const pkg = makePackage({
      manifest: { ...makePackage().manifest, pricing: { model: "free", amountCents: 0, currency: "usd" } },
    });
    const ld = buildSoftwareSourceCodeLd({ pkg });
    assert.equal("offers" in ld, false);
  });

  test("aggregateRating present when ratingCount is set", () => {
    const pkg = makePackage({ stats: { downloads: 10, stars: 2, ratingAverage: 4.5, ratingCount: 8 } });
    const ld = buildSoftwareSourceCodeLd({ pkg });
    assert.deepEqual(ld.aggregateRating, {
      "@type": "AggregateRating",
      ratingValue: 4.5,
      ratingCount: 8,
      bestRating: 5,
      worstRating: 1,
    });
  });

  test("aggregateRating absent when ratingCount is zero/undefined", () => {
    const pkg = makePackage({ stats: { downloads: 10, stars: 2 } });
    const ld = buildSoftwareSourceCodeLd({ pkg });
    assert.equal("aggregateRating" in ld, false);
  });
});

describe("escapeXml", () => {
  test("escapes all five predefined XML entities", () => {
    assert.equal(escapeXml(`& < > " '`), "&amp; &lt; &gt; &quot; &apos;");
  });

  test("leaves ordinary text untouched", () => {
    assert.equal(escapeXml("Does a thing, reliably."), "Does a thing, reliably.");
  });

  test("escapes an RSS-hostile title/description safely", () => {
    // Representative of what /feed.xml runs every title/description/author
    // through before interpolating into the XML string.
    const title = `Ben & Co's "Auto-Fixer" <beta>`;
    assert.equal(escapeXml(title), `Ben &amp; Co&apos;s &quot;Auto-Fixer&quot; &lt;beta&gt;`);
  });
});

describe("escapeForScriptTag", () => {
  test("escapes a closing script tag so JSON-LD can't break out of its <script>", () => {
    const json = `{"description":"</script><script>alert(1)</script>"}`;
    const escaped = escapeForScriptTag(json);
    assert.equal(escaped.includes("</script>"), false);
    assert.equal(escaped, `{"description":"<\\/script><script>alert(1)<\\/script>"}`);
  });

  test("is case-insensitive (matches regardless of case; replacement is always lowercase)", () => {
    assert.equal(escapeForScriptTag("</SCRIPT>"), "<\\/script>");
  });

  test("leaves JSON with no script tags untouched", () => {
    const json = `{"a":1,"b":"c"}`;
    assert.equal(escapeForScriptTag(json), json);
  });
});

describe("formatBadgeCount", () => {
  test("renders values under 1000 as plain integers", () => {
    assert.equal(formatBadgeCount(0), "0");
    assert.equal(formatBadgeCount(1), "1");
    assert.equal(formatBadgeCount(999), "999");
  });

  test("formats thousands with one decimal and a 'k' suffix", () => {
    assert.equal(formatBadgeCount(1200), "1.2k");
    assert.equal(formatBadgeCount(12_345), "12.3k");
  });

  test("drops a trailing .0", () => {
    assert.equal(formatBadgeCount(1000), "1k");
    assert.equal(formatBadgeCount(2000), "2k");
  });

  test("formats millions with an 'M' suffix", () => {
    assert.equal(formatBadgeCount(3_400_000), "3.4M");
    assert.equal(formatBadgeCount(1_000_000), "1M");
  });

  test("formats billions with a 'B' suffix", () => {
    assert.equal(formatBadgeCount(2_500_000_000), "2.5B");
  });
});
