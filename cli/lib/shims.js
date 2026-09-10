// Runtime discovery shims (B5): the file(s) a given runtime actually looks
// for at install time, generated from the manifest so an installed package
// is discoverable by Claude Code / Codex (SKILL.md with frontmatter) and
// Cursor (.cursor/rules/<name>.mdc), instead of sitting invisible next to a
// WORKFLOW.md / HARNESS.md / RULES.md the runtime never reads.
//
// Pure by design (no fs access) so it can be unit tested directly: callers
// read whatever on-disk state is relevant (the entry file's current content,
// an existing shim's current content) and pass it in as `opts`.

/** Quote a string safely for a YAML frontmatter scalar: one line, <= 1024 chars, escaped. */
export function yamlFrontmatterQuote(value) {
  const oneLine = String(value ?? "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
  const limited = oneLine.length > 1024 ? oneLine.slice(0, 1021) + "..." : oneLine;
  return `"${limited.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function description(manifest) {
  return manifest.summary || manifest.title || manifest.name;
}

function claudeCodeFrontmatter(manifest) {
  return `---\nname: ${manifest.name}\ndescription: ${yamlFrontmatterQuote(description(manifest))}\n---\n\n`;
}

function supportingFiles(manifest) {
  return (Array.isArray(manifest.files) ? manifest.files : []).filter((f) => f !== manifest.entry);
}

function skillBody(manifest) {
  const supporting = supportingFiles(manifest);
  const supportingLine = supporting.length ? supporting.join(", ") : "(none)";
  return (
    `This is the OpenAgents ${manifest.kind} package \`${manifest.owner}/${manifest.name}\` v${manifest.version}. ` +
    `Read \`${manifest.entry}\` in this directory and follow it. Supporting files: ${supportingLine}.\n`
  );
}

/**
 * Build the claude-code/codex shim: writes/rewrites `SKILL.md` in the
 * install directory.
 *
 * opts.entryContent — current contents of the installed `manifest.entry`
 *   file, only relevant (and required to decide anything) when
 *   `manifest.entry === "SKILL.md"`.
 * opts.existingShimContent — current contents of a previously-generated
 *   `SKILL.md`, when `manifest.entry !== "SKILL.md"` and a file already
 *   exists at that path in the install dir from a prior install.
 *
 * Returns `{ files: [{ path, content }], note }`. `files` is empty when no
 * write is needed (already has frontmatter) or when an existing
 * user-modified shim must be preserved (`note` explains why).
 */
export function buildClaudeCodeShim(manifest, opts = {}) {
  const { entryContent, existingShimContent } = opts;

  if (manifest.entry === "SKILL.md") {
    if (typeof entryContent === "string" && entryContent.trimStart().startsWith("---")) {
      return { files: [], note: null };
    }
    const content = claudeCodeFrontmatter(manifest) + (entryContent || "");
    return { files: [{ path: "SKILL.md", content }], note: null };
  }

  const content = claudeCodeFrontmatter(manifest) + skillBody(manifest);
  const ownedByPackage = Array.isArray(manifest.files) && manifest.files.includes("SKILL.md");
  if (ownedByPackage) {
    // The package ships its own SKILL.md alongside a different entry; leave
    // it alone rather than clobbering package-provided content.
    return { files: [], note: null };
  }
  if (typeof existingShimContent === "string" && existingShimContent !== content) {
    return {
      files: [],
      note: `SKILL.md already exists and differs from the generated shim; left it alone (delete it, or edit ${manifest.entry} directly, to regenerate).`,
    };
  }
  return { files: [{ path: "SKILL.md", content }], note: null };
}

/**
 * Build the Cursor shim: `.cursor/rules/<name>.mdc`, a sibling of the
 * `.cursor/rules/<name>/` install directory, at the project root.
 *
 * opts.existingShimContent — current contents of a previously-generated
 * `.mdc` file, if one exists.
 */
export function buildCursorShim(manifest, opts = {}) {
  const { existingShimContent } = opts;
  const alwaysApply = manifest.kind === "rules";
  const supporting = supportingFiles(manifest);
  const supportingLine = supporting.length ? `\nSupporting files: ${supporting.join(", ")}.` : "";
  const content =
    `---\ndescription: ${yamlFrontmatterQuote(description(manifest))}\nglobs: []\nalwaysApply: ${alwaysApply}\n---\n\n` +
    `Follow @.cursor/rules/${manifest.name}/${manifest.entry} for this package (\`${manifest.owner}/${manifest.name}\`).${supportingLine}\n`;
  const shimPath = `.cursor/rules/${manifest.name}.mdc`;

  if (typeof existingShimContent === "string" && existingShimContent !== content) {
    return {
      files: [],
      note: `${shimPath} already exists and differs from the generated shim; left it alone.`,
    };
  }
  return { files: [{ path: shimPath, content }], note: null };
}

/**
 * Build the runtime discovery shim(s) for an install. Returns
 * `{ files: [{ path, content }], note }`:
 *  - `claude-code` / `codex`: `path` is relative to the package's install
 *    directory (`SKILL.md`).
 *  - `cursor`: `path` is relative to the PROJECT root
 *    (`.cursor/rules/<name>.mdc`, a sibling of the install directory).
 *  - `generic` / `openai-agents` / `langgraph`: no shim, `files` is empty.
 */
export function buildShims(manifest, runtime, opts = {}) {
  if (runtime === "claude-code" || runtime === "codex") {
    return buildClaudeCodeShim(manifest, opts);
  }
  if (runtime === "cursor") {
    return buildCursorShim(manifest, opts);
  }
  return { files: [], note: null };
}

/** One-line "what happens next" hint printed after every install. */
export function nextStepHint(manifest, runtime, installDirRelative) {
  const contextFile = runtime === "codex" ? "AGENTS.md" : "CLAUDE.md";
  switch (runtime) {
    case "claude-code":
    case "codex":
      if (manifest.kind === "rules") {
        return `Tip: add "@${installDirRelative}/${manifest.entry}" to your ${contextFile} to load these rules every session.`;
      }
      return `Tip: ${runtime === "claude-code" ? "Claude Code" : "Codex"} will discover this automatically via ${installDirRelative}/SKILL.md.`;
    case "cursor":
      if (manifest.kind === "rules") {
        return `Tip: Cursor will apply this automatically (alwaysApply: true in .cursor/rules/${manifest.name}.mdc).`;
      }
      return `Tip: Cursor picks this up via .cursor/rules/${manifest.name}.mdc; @-mention it, or ask Cursor to use it, when relevant.`;
    default:
      return `Tip: point your bootstrap at ${installDirRelative}/${manifest.entry}.`;
  }
}
