"use client";

import { useState } from "react";
import { highlight, type Token, type TokenType } from "@/lib/highlight";

interface CodeBlockProps {
  code: string;
  language?: string;
  /** File-viewer mode: a line-number gutter down the left. Off for README
   *  fenced code, where line numbers would just be noise. */
  showLineNumbers?: boolean;
  className?: string;
}

// Tailwind color tokens for each token class (G-C4). Emerald/sky/amber echo
// the kind-badge palette elsewhere in the UI (see KindBadge.tsx) rather than
// introducing a new set of hues.
const TOKEN_CLASSES: Record<TokenType, string> = {
  keyword: "text-sky-600 dark:text-sky-400",
  string: "text-emerald-600 dark:text-emerald-400",
  comment: "text-fg-subtle italic",
  number: "text-amber-600 dark:text-amber-400",
  plain: "text-fg",
};

function renderTokens(tokens: Token[]) {
  return tokens.map((token, i) =>
    token.type === "plain" ? (
      token.value
    ) : (
      <span key={i} className={TOKEN_CLASSES[token.type]}>
        {token.value}
      </span>
    )
  );
}

/** Highlighted code with a copy button and language label (G-C4). Used by
 *  `Markdown.tsx` for README fenced code blocks and by the file viewer page
 *  for full-file previews (with `showLineNumbers`). Renders its own `<pre>`
 *  — see the `!`-prefixed classes below, which win over the `.prose-oa pre`
 *  rule in globals.css (a `.prose-oa pre` element selector otherwise beats a
 *  same-specificity utility class) so this box's own border/background is
 *  the only one that shows, in or out of a README. */
export function CodeBlock({ code, language, showLineNumbers = false, className = "" }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const lines = highlight(code, language);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable; ignore
    }
  }

  return (
    <div className={`overflow-hidden rounded-lg border border-border bg-bg-elevated text-sm ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5">
        <span className="font-mono text-xs text-fg-subtle">{language ?? "text"}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy code"}
          className="text-xs font-medium text-fg-muted transition-colors hover:text-fg"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="!m-0 !border-0 !bg-transparent !p-0 overflow-x-auto">
        {showLineNumbers ? (
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((tokens, i) => (
                <tr key={i}>
                  <td className="select-none border-r border-border px-3 py-0 text-right align-top text-fg-subtle">
                    {i + 1}
                  </td>
                  <td className="w-full whitespace-pre px-3 py-0 align-top font-mono">
                    {renderTokens(tokens)}
                    {tokens.length === 0 ? " " : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <code className="block px-4 py-3 font-mono">
            {lines.map((tokens, i) => (
              <div key={i} className="whitespace-pre">
                {renderTokens(tokens)}
                {tokens.length === 0 ? " " : null}
              </div>
            ))}
          </code>
        )}
      </pre>
    </div>
  );
}
