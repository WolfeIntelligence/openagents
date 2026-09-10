// Run via `npm test` (node --import tsx --test) or `npx tsx --test <this file>`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { highlight, resolveLanguage, type Token } from "../highlight";

/** Flattens a line's tokens to `[type, value]` pairs for compact assertions. */
function shape(tokens: Token[]): [string, string][] {
  return tokens.map((t) => [t.type, t.value]);
}

describe("resolveLanguage", () => {
  test("maps common extensions and aliases to a supported language", () => {
    assert.equal(resolveLanguage("sh"), "bash");
    assert.equal(resolveLanguage(".sh"), "bash");
    assert.equal(resolveLanguage("YAML"), "yaml");
    assert.equal(resolveLanguage("tsx"), "ts");
    assert.equal(resolveLanguage("js"), "ts");
    assert.equal(resolveLanguage("py"), "python");
  });

  test("returns undefined for missing or unsupported input", () => {
    assert.equal(resolveLanguage(undefined), undefined);
    assert.equal(resolveLanguage("brainfuck"), undefined);
  });
});

describe("highlight — plain fallback", () => {
  test("an unsupported/absent language returns one plain token per line", () => {
    const lines = highlight("hello\nworld", "brainfuck");
    assert.deepEqual(
      lines.map(shape),
      [[["plain", "hello"]], [["plain", "world"]]]
    );
  });
});

describe("highlight — bash", () => {
  test("tokenizes a keyword, a string, and a line comment", () => {
    const [line] = highlight('if [ "$x" = "y" ]; then echo "ok"; fi # done', "bash");
    const kinds = line.map((t) => t.type);
    assert.ok(kinds.includes("keyword"));
    assert.ok(kinds.includes("string"));
    assert.ok(kinds.includes("comment"));
    assert.equal(line.at(-1)!.type, "comment");
    assert.equal(line.at(-1)!.value, "# done");
  });
});

describe("highlight — json", () => {
  test("tokenizes strings, a number, and the true/false/null keywords", () => {
    const [line] = highlight('{"a": 1, "b": true, "c": null}', "json");
    const kinds = line.map((t) => t.type);
    assert.ok(kinds.includes("string"));
    assert.ok(kinds.includes("number"));
    assert.ok(kinds.includes("keyword"));
  });
});

describe("highlight — ts", () => {
  test("tokenizes a keyword, string, and line comment", () => {
    const [line] = highlight('const x = "hi"; // greet', "ts");
    assert.deepEqual(shape(line), [
      ["keyword", "const"],
      ["plain", " x = "],
      ["string", '"hi"'],
      ["plain", "; "],
      ["comment", "// greet"],
    ]);
  });

  test("a block comment spans multiple lines", () => {
    const lines = highlight("/* start\nmiddle\nend */\nconst y = 1;", "ts");
    assert.equal(lines[0][0].type, "comment");
    assert.deepEqual(shape(lines[1]), [["comment", "middle"]]);
    assert.equal(lines[2][0].type, "comment");
    assert.ok(lines[2][0].value.endsWith("end */"));
    // The comment closed on line 3 — line 4 tokenizes normally again.
    assert.equal(lines[3][0].type, "keyword");
  });

  test("does not split an identifier that merely contains digits", () => {
    const [line] = highlight("const item1 = 2;", "ts");
    assert.deepEqual(shape(line), [
      ["keyword", "const"],
      ["plain", " item1 = "],
      ["number", "2"],
      ["plain", ";"],
    ]);
  });
});

describe("highlight — python", () => {
  test("tokenizes a def keyword and a comment", () => {
    const [line] = highlight("def f():  # comment", "python");
    assert.equal(line[0].type, "keyword");
    assert.equal(line[0].value, "def");
    assert.equal(line.at(-1)!.type, "comment");
  });
});

describe("highlight — sql", () => {
  test("keyword matching is case-insensitive", () => {
    const [upper] = highlight("SELECT * FROM t", "sql");
    const [lower] = highlight("select * from t", "sql");
    assert.deepEqual(
      upper.filter((t) => t.type === "keyword").map((t) => t.value),
      ["SELECT", "FROM"]
    );
    assert.deepEqual(
      lower.filter((t) => t.type === "keyword").map((t) => t.value),
      ["select", "from"]
    );
  });

  test("-- starts a line comment", () => {
    const [line] = highlight("SELECT 1 -- note", "sql");
    assert.equal(line.at(-1)!.type, "comment");
    assert.equal(line.at(-1)!.value, "-- note");
  });
});
