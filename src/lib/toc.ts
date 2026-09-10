// Table of contents for a README (G-C4): parses ATX (`#`) headings out of raw
// markdown, skipping fenced code blocks so a `#` inside an example never
// counts. Reuses `createSlugger` from `components/Markdown.tsx` so a TOC
// entry's `id` always matches the `id` Markdown.tsx actually gives that
// heading when it renders — same slug function, same top-to-bottom order, so
// per-heading duplicate-text suffixing (`-1`, `-2`, ...) lines up too.
import { createSlugger } from "@/components/Markdown";

export interface TocEntry {
  /** The *source* markdown heading level (1-6), before Markdown.tsx's
   *  h1->h2 accessibility demotion — used only for indentation here. */
  level: number;
  text: string;
  id: string;
}

/** Undoes the inline markdown syntax react-markdown would already have
 *  resolved away by the time `extractText` (in Markdown.tsx) reads a
 *  rendered heading's text — e.g. `**bold**` renders as the plain text
 *  "bold". Approximate on purpose: it only needs to agree with `extractText`
 *  closely enough that the two derive the same slug for the same heading. */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // image -> alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // link -> label
    .replace(/(\*\*\*|___)(.+?)\1/g, "$2")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .replace(/~~(.+?)~~/g, "$1")
    .trim();
}

/** Parses ATX headings (`#` through `######`) out of raw markdown, ignoring
 *  anything inside a fenced (``` or ~~~) code block. Setext headings (`===`/
 *  `---` underlines) aren't handled — every README and doc page in this repo
 *  uses ATX style. */
export function extractHeadings(markdown: string): { level: number; text: string }[] {
  const headings: { level: number; text: string }[] = [];
  let inFence = false;
  let fenceChar = "";

  for (const line of markdown.split("\n")) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const char = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = char;
      } else if (char === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (headingMatch) {
      const text = stripInlineMarkdown(headingMatch[2]);
      if (text) headings.push({ level: headingMatch[1].length, text });
    }
  }
  return headings;
}

/** Builds a table of contents from raw markdown, id-matched to how
 *  `Markdown.tsx` will render those same headings. */
export function buildToc(markdown: string): TocEntry[] {
  const slug = createSlugger();
  return extractHeadings(markdown).map(({ level, text }) => ({ level, text, id: slug(text) }));
}
