import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildShims, buildClaudeCodeShim, buildCursorShim, nextStepHint, yamlFrontmatterQuote } from "../lib/shims.js";

const workflowManifest = {
  owner: "openagents",
  name: "pr-reviewer",
  version: "1.2.0",
  kind: "workflow",
  title: "Pull Request Reviewer",
  summary: "Structured PR review with risk classification",
  entry: "WORKFLOW.md",
  files: ["WORKFLOW.md", "rules/review-checklist.md", "templates/review-comment.md"],
};

const rulesManifest = {
  owner: "openagents",
  name: "accessibility-rules",
  version: "1.0.0",
  kind: "rules",
  title: "Accessibility Rules",
  summary: "Rules for agent-written UI",
  entry: "RULES.md",
  files: ["RULES.md"],
};

const skillManifest = {
  owner: "someone",
  name: "my-skill",
  version: "1.0.0",
  kind: "skill",
  title: "My Skill",
  summary: "Does a thing",
  entry: "SKILL.md",
  files: ["SKILL.md", "helpers/run.js"],
};

describe("buildShims: claude-code / codex", () => {
  test("entry !== SKILL.md: writes a new SKILL.md with frontmatter pointing at entry", () => {
    for (const runtime of ["claude-code", "codex"]) {
      const { files, note } = buildShims(workflowManifest, runtime);
      assert.equal(note, null);
      assert.equal(files.length, 1);
      assert.equal(files[0].path, "SKILL.md");
      assert.match(files[0].content, /^---\nname: pr-reviewer\ndescription: "Structured PR review with risk classification"\n---\n\n/);
      assert.match(files[0].content, /Read `WORKFLOW.md` in this directory and follow it\./);
      assert.match(files[0].content, /Supporting files: rules\/review-checklist\.md, templates\/review-comment\.md\./);
      assert.match(files[0].content, /openagents\/pr-reviewer.*v1\.2\.0/);
    }
  });

  test("entry === SKILL.md with existing frontmatter: leaves it alone", () => {
    const { files, note } = buildClaudeCodeShim(skillManifest, {
      entryContent: "---\nname: my-skill\ndescription: \"x\"\n---\n\nBody.\n",
    });
    assert.deepEqual(files, []);
    assert.equal(note, null);
  });

  test("entry === SKILL.md without frontmatter: prepends it", () => {
    const { files, note } = buildClaudeCodeShim(skillManifest, {
      entryContent: "# My Skill\n\nDo the thing.\n",
    });
    assert.equal(note, null);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, "SKILL.md");
    assert.equal(
      files[0].content,
      '---\nname: my-skill\ndescription: "Does a thing"\n---\n\n# My Skill\n\nDo the thing.\n'
    );
  });

  test("does not clobber a user-edited generated SKILL.md", () => {
    const generated = buildClaudeCodeShim(workflowManifest).files[0].content;
    const userEdited = generated + "\n<!-- I added notes here -->\n";
    const { files, note } = buildClaudeCodeShim(workflowManifest, { existingShimContent: userEdited });
    assert.deepEqual(files, []);
    assert.match(note, /already exists and differs/);
  });

  test("regenerates when the existing shim is byte-identical to what we'd write", () => {
    const generated = buildClaudeCodeShim(workflowManifest).files[0].content;
    const { files, note } = buildClaudeCodeShim(workflowManifest, { existingShimContent: generated });
    assert.equal(note, null);
    assert.equal(files.length, 1);
    assert.equal(files[0].content, generated);
  });

  test("does not generate a shim when the package ships its own SKILL.md as a non-entry file", () => {
    const manifestWithOwnSkillMd = { ...workflowManifest, files: [...workflowManifest.files, "SKILL.md"] };
    const { files, note } = buildClaudeCodeShim(manifestWithOwnSkillMd, {
      existingShimContent: "# whatever the package shipped\n",
    });
    assert.deepEqual(files, []);
    assert.equal(note, null);
  });
});

describe("buildShims: cursor", () => {
  test("writes .cursor/rules/<name>.mdc with alwaysApply: false for non-rules kinds", () => {
    const { files, note } = buildShims(workflowManifest, "cursor");
    assert.equal(note, null);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, ".cursor/rules/pr-reviewer.mdc");
    assert.match(files[0].content, /^---\ndescription: "[^"]+"\nglobs: \[\]\nalwaysApply: false\n---\n\n/);
    assert.match(files[0].content, /@\.cursor\/rules\/pr-reviewer\/WORKFLOW\.md/);
  });

  test("alwaysApply: true for kind: rules", () => {
    const { files } = buildShims(rulesManifest, "cursor");
    assert.match(files[0].content, /alwaysApply: true/);
  });

  test("leaves a user-edited .mdc alone", () => {
    const generated = buildCursorShim(workflowManifest).files[0].content;
    const { files, note } = buildCursorShim(workflowManifest, { existingShimContent: generated + "extra" });
    assert.deepEqual(files, []);
    assert.match(note, /already exists and differs/);
  });
});

describe("buildShims: no-op runtimes", () => {
  test("generic, openai-agents, langgraph produce no shim files", () => {
    for (const runtime of ["generic", "openai-agents", "langgraph"]) {
      const { files, note } = buildShims(workflowManifest, runtime);
      assert.deepEqual(files, []);
      assert.equal(note, null);
    }
  });
});

describe("nextStepHint", () => {
  test("rules kind on claude-code suggests adding to CLAUDE.md", () => {
    const hint = nextStepHint(rulesManifest, "claude-code", ".claude/skills/accessibility-rules");
    assert.match(hint, /@\.claude\/skills\/accessibility-rules\/RULES\.md/);
    assert.match(hint, /CLAUDE\.md/);
  });

  test("rules kind on codex suggests AGENTS.md", () => {
    const hint = nextStepHint(rulesManifest, "codex", ".codex/skills/accessibility-rules");
    assert.match(hint, /AGENTS\.md/);
  });

  test("generic/openai-agents/langgraph point at the install dir + entry", () => {
    for (const runtime of ["generic", "openai-agents", "langgraph"]) {
      const hint = nextStepHint(workflowManifest, runtime, ".openagents/pr-reviewer");
      assert.match(hint, /\.openagents\/pr-reviewer\/WORKFLOW\.md/);
    }
  });
});

describe("yamlFrontmatterQuote", () => {
  test("escapes quotes and backslashes, collapses newlines, single-lines the result", () => {
    assert.equal(yamlFrontmatterQuote('has "quotes" and \\backslash'), '"has \\"quotes\\" and \\\\backslash"');
    assert.equal(yamlFrontmatterQuote("line one\nline two"), '"line one line two"');
  });

  test("truncates to <= 1024 chars", () => {
    const long = "x".repeat(2000);
    const quoted = yamlFrontmatterQuote(long);
    assert.ok(quoted.length <= 1026, `expected <= 1026 chars (1024 + quotes), got ${quoted.length}`);
  });
});
