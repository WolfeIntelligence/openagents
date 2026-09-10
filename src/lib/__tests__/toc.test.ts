// Run via `npm test` (node --import tsx --test) or `npx tsx --test <this file>`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractHeadings, buildToc } from "../toc";
import { createSlugger, slugify } from "@/components/Markdown";

describe("extractHeadings", () => {
  test("parses ATX headings of every level", () => {
    const md = "# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six";
    assert.deepEqual(extractHeadings(md), [
      { level: 1, text: "One" },
      { level: 2, text: "Two" },
      { level: 3, text: "Three" },
      { level: 4, text: "Four" },
      { level: 5, text: "Five" },
      { level: 6, text: "Six" },
    ]);
  });

  test("ignores a line that isn't a heading (no space after #, or not at line start)", () => {
    assert.deepEqual(extractHeadings("#no-space-heading\ntext # not a heading"), []);
  });

  test("skips headings inside fenced code blocks", () => {
    const md = ["# Real heading", "```", "# not a heading", "```", "## Also real"].join("\n");
    assert.deepEqual(extractHeadings(md), [
      { level: 1, text: "Real heading" },
      { level: 2, text: "Also real" },
    ]);
  });

  test("skips headings inside a ~~~ fence too", () => {
    const md = ["~~~", "# not a heading", "~~~", "# Real"].join("\n");
    assert.deepEqual(extractHeadings(md), [{ level: 1, text: "Real" }]);
  });

  test("strips trailing closing hashes (`## Two ##`)", () => {
    assert.deepEqual(extractHeadings("## Two ##"), [{ level: 2, text: "Two" }]);
  });

  test("strips inline markdown syntax from heading text", () => {
    const md = "## **Bold** and `code` and [a link](https://example.com)";
    assert.deepEqual(extractHeadings(md), [{ level: 2, text: "Bold and code and a link" }]);
  });
});

describe("buildToc", () => {
  test("assigns ids using the same slugger Markdown.tsx uses", () => {
    const md = "# Getting Started\n## Getting Started";
    const toc = buildToc(md);
    const slug = createSlugger();
    assert.equal(toc[0].id, slug("Getting Started"));
    assert.equal(toc[1].id, slug("Getting Started")); // second call -> the "-1" suffix
    assert.notEqual(toc[0].id, toc[1].id);
  });

  test("id matches slugify() for a heading with no duplicates", () => {
    const toc = buildToc("# Install & Run");
    assert.equal(toc[0].id, slugify("Install & Run"));
  });

  test("returns an empty array for markdown with no headings", () => {
    assert.deepEqual(buildToc("just a paragraph, no headings here"), []);
  });
});
