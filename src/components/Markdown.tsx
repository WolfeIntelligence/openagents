import { isValidElement, type ComponentPropsWithoutRef, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type UrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "@/components/CodeBlock";
import { Toc } from "@/components/Toc";
import { buildToc } from "@/lib/toc";

/** README table of contents (G-C4) only earns its place once there's
 *  actually something to jump around — below this, it's just noise above
 *  a README that would've rendered fine without it. */
const MIN_HEADINGS_FOR_TOC = 4;

interface MarkdownProps {
  content: string;
  className?: string;
  /** Package owner/name, used to rewrite relative README links and images (see B15). */
  owner?: string;
  name?: string;
}

/** True for absolute URLs (has a scheme, e.g. `https:`, `mailto:`) or protocol-relative `//`. */
function isAbsoluteUrl(url: string): boolean {
  return /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(url);
}

/** Strips a leading `./` or `/`; refuses (leaves untouched) anything that tries to climb out with `..`. */
function normalizeRelativePath(url: string): string | null {
  if (url.includes("..")) return null;
  return url.replace(/^\.?\/+/, "");
}

function makeUrlTransform(owner?: string, name?: string): UrlTransform {
  return (url, key) => {
    if (!url) return url;
    if (url.startsWith("#")) return url;
    if (isAbsoluteUrl(url)) return defaultUrlTransform(url);
    if (!owner || !name) return defaultUrlTransform(url);

    const normalized = normalizeRelativePath(url);
    if (normalized === null) return defaultUrlTransform(url);

    if (key === "src") {
      return `/api/v1/packages/${owner}/${name}/files/${normalized}`;
    }
    return `/p/${owner}/${name}/files/${normalized}`;
  };
}

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return "";
}

/** github-style slug: lowercase, strip punctuation, spaces to hyphens. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 \-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** A stateful slugger: the same base slug seen twice gets `-1`, `-2`, ...
 *  suffixes (github's own disambiguation rule), so headings that repeat text
 *  ("Usage" appearing under two sections) still get distinct anchor ids.
 *  Exported so `lib/toc.ts` can build a table of contents whose ids agree
 *  with the ones headings actually get when this component renders them —
 *  same function, walked over the same headings in the same order. */
export function createSlugger(): (text: string) => string {
  const counts = new Map<string, number>();
  return (text: string) => {
    const base = slugify(text);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}

type HeadingProps = ComponentPropsWithoutRef<"h1">;

function makeHeadingComponents(): Partial<Record<`h${1 | 2 | 3 | 4 | 5 | 6}`, (props: HeadingProps) => ReactNode>> {
  const uniqueSlug = createSlugger();

  // Demote headings one level (h1->h2 ... h5->h6) so the README never introduces
  // a second <h1> on the package page; h6 has nowhere lower to go.
  const demote: Record<"h1" | "h2" | "h3" | "h4" | "h5" | "h6", "h2" | "h3" | "h4" | "h5" | "h6"> = {
    h1: "h2",
    h2: "h3",
    h3: "h4",
    h4: "h5",
    h5: "h6",
    h6: "h6",
  };

  const components: Partial<Record<`h${1 | 2 | 3 | 4 | 5 | 6}`, (props: HeadingProps) => ReactNode>> = {};
  for (const [from, Tag] of Object.entries(demote) as [keyof typeof demote, "h2" | "h3" | "h4" | "h5" | "h6"][]) {
    components[from] = ({ children, ...props }: HeadingProps) => {
      const id = uniqueSlug(slugify(extractText(children)));
      const HeadingTag = Tag;
      return (
        <HeadingTag id={id} {...props}>
          {children}
        </HeadingTag>
      );
    };
  }
  return components;
}

function ExternalAwareLink({ href = "", children, ...props }: ComponentPropsWithoutRef<"a">) {
  const external = isAbsoluteUrl(href) && !href.startsWith("mailto:");
  return (
    <a href={href} {...props} {...(external ? { target: "_blank", rel: "noreferrer" } : {})}>
      {children}
    </a>
  );
}

/** react-markdown gives fenced code a `language-xxx` className (from the
 *  fence's info string) and gives inline code no className at all — that
 *  distinction is all `CodeBlock` needs to only take over fenced blocks. */
function CodeRenderer({ className, children }: ComponentPropsWithoutRef<"code">) {
  const match = /language-(\S+)/.exec(className ?? "");
  if (!match) {
    return <code className={className}>{children}</code>; // inline code — .prose-oa code styles this
  }
  return <CodeBlock code={extractText(children).replace(/\n$/, "")} language={match[1]} />;
}

/** `CodeBlock` already renders its own `<pre>`, so the `pre` react-markdown
 *  wraps a fenced `code` in is flattened away here rather than nested. */
function PreRenderer({ children }: ComponentPropsWithoutRef<"pre">) {
  return <>{children}</>;
}

export function Markdown({ content, className = "", owner, name }: MarkdownProps) {
  const toc = buildToc(content);
  return (
    <div className={`prose-oa ${className}`}>
      {toc.length >= MIN_HEADINGS_FOR_TOC && <Toc entries={toc} />}
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={makeUrlTransform(owner, name)}
        components={{
          ...makeHeadingComponents(),
          a: ExternalAwareLink,
          code: CodeRenderer,
          pre: PreRenderer,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
