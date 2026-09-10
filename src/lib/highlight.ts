// Dependency-free syntax highlighter for bash/sh, json, yaml, ts/js, python,
// sql — no syntax-highlighting library is a project dependency (AGENTS.md).
// A small hand-rolled tokenizer covering keyword/string/comment/number token
// classes; good enough for a code preview, not a full-fidelity grammar.
// Used by `CodeBlock` for README fenced code blocks and the file viewer.

export type TokenType = "keyword" | "string" | "comment" | "number" | "plain";
export interface Token { type: TokenType; value: string; }

interface LangSpec {
  keywords: Set<string>;
  caseInsensitiveKeywords?: boolean;
  lineComment?: string;
  blockComment?: [string, string];
  /** Quote characters that start/end a string; strings don't span lines. */
  quotes: string[];
}

function kw(words: string[]): Set<string> {
  return new Set(words);
}
function isIdentStart(c: string): boolean { return /[A-Za-z_$]/.test(c); }
function isIdentPart(c: string): boolean { return /[A-Za-z0-9_$]/.test(c); }
function isDigit(c: string): boolean { return /[0-9]/.test(c); }

const JS_KEYWORDS = [
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do", "switch",
  "case", "default", "break", "continue", "class", "interface", "type", "import", "export",
  "from", "as", "new", "this", "extends", "implements", "public", "private", "protected",
  "readonly", "async", "await", "try", "catch", "finally", "throw", "yield", "void", "typeof",
  "instanceof", "in", "of", "null", "undefined", "true", "false", "enum", "namespace", "declare",
  "static", "get", "set", "super",
];

const LANGS: Record<string, LangSpec> = {
  bash: {
    keywords: kw([
      "if", "then", "else", "elif", "fi", "for", "in", "while", "until", "do", "done", "case",
      "esac", "function", "return", "local", "export", "echo", "set", "break", "continue",
      "shift", "exit", "source",
    ]),
    lineComment: "#",
    quotes: ['"', "'"],
  },
  json: { keywords: kw(["true", "false", "null"]), quotes: ['"'] },
  yaml: { keywords: kw(["true", "false", "null", "yes", "no"]), lineComment: "#", quotes: ['"', "'"] },
  ts: { keywords: kw(JS_KEYWORDS), lineComment: "//", blockComment: ["/*", "*/"], quotes: ['"', "'", "`"] },
  python: {
    keywords: kw([
      "def", "return", "if", "elif", "else", "for", "while", "in", "not", "and", "or", "import",
      "from", "as", "class", "try", "except", "finally", "raise", "with", "lambda", "pass",
      "break", "continue", "global", "nonlocal", "yield", "None", "True", "False", "is", "del",
      "assert", "async", "await",
    ]),
    lineComment: "#",
    quotes: ['"', "'"],
  },
  sql: {
    keywords: kw([
      "select", "from", "where", "insert", "into", "values", "update", "set", "delete", "join",
      "left", "right", "inner", "outer", "on", "group", "by", "order", "having", "limit",
      "offset", "and", "or", "not", "null", "is", "in", "as", "create", "table", "alter", "drop",
      "primary", "key", "foreign", "references", "default", "unique", "index", "view", "union",
      "all", "distinct", "case", "when", "then", "end", "returning",
    ]),
    caseInsensitiveKeywords: true,
    lineComment: "--",
    blockComment: ["/*", "*/"],
    quotes: ["'"],
  },
};

/** Maps a file extension or a fenced-code-block language tag to one of the
 *  keys in `LANGS` (or `undefined` for anything unsupported, which renders
 *  as plain unhighlighted text rather than guessing). */
export function resolveLanguage(langOrExt?: string): string | undefined {
  if (!langOrExt) return undefined;
  const key = langOrExt.toLowerCase().replace(/^\./, "");
  const map: Record<string, string> = {
    sh: "bash", bash: "bash", zsh: "bash", shell: "bash",
    json: "json", jsonc: "json",
    yml: "yaml", yaml: "yaml",
    ts: "ts", tsx: "ts", js: "ts", jsx: "ts", mjs: "ts", cjs: "ts", javascript: "ts", typescript: "ts",
    py: "python", python: "python",
    sql: "sql",
  };
  return map[key];
}

/** Tokenizes one line, given whether it started inside an unterminated block
 *  comment. Returns the tokens plus whether the line *ends* inside one, so
 *  the caller can thread that state to the next line. */
function tokenizeLine(line: string, spec: LangSpec, startInBlock: boolean): { tokens: Token[]; inBlock: boolean } {
  const tokens: Token[] = [];
  let plain = "";
  let i = 0;
  let inBlock = startInBlock;

  const flushPlain = () => {
    if (plain) {
      tokens.push({ type: "plain", value: plain });
      plain = "";
    }
  };

  while (i < line.length) {
    if (inBlock) {
      const end = spec.blockComment ? line.indexOf(spec.blockComment[1], i) : -1;
      if (end === -1) {
        tokens.push({ type: "comment", value: line.slice(i) });
        return { tokens, inBlock: true };
      }
      tokens.push({ type: "comment", value: line.slice(i, end + spec.blockComment![1].length) });
      i = end + spec.blockComment![1].length;
      inBlock = false;
      continue;
    }

    const rest = line.slice(i);
    if (spec.blockComment && rest.startsWith(spec.blockComment[0])) {
      flushPlain();
      const end = line.indexOf(spec.blockComment[1], i + spec.blockComment[0].length);
      if (end === -1) {
        tokens.push({ type: "comment", value: rest });
        return { tokens, inBlock: true };
      }
      tokens.push({ type: "comment", value: line.slice(i, end + spec.blockComment[1].length) });
      i = end + spec.blockComment[1].length;
      continue;
    }
    if (spec.lineComment && rest.startsWith(spec.lineComment)) {
      flushPlain();
      tokens.push({ type: "comment", value: rest });
      return { tokens, inBlock: false };
    }

    const c = line[i];
    if (spec.quotes.includes(c)) {
      flushPlain();
      let j = i + 1;
      while (j < line.length && line[j] !== c) {
        if (line[j] === "\\") j++; // skip an escaped character, including an escaped quote
        j++;
      }
      const end = Math.min(j + 1, line.length);
      tokens.push({ type: "string", value: line.slice(i, end) });
      i = end;
      continue;
    }

    if (isDigit(c) && (i === 0 || !isIdentPart(line[i - 1]))) {
      flushPlain();
      let j = i + 1;
      while (j < line.length && /[0-9.eExXa-fA-F]/.test(line[j])) j++;
      tokens.push({ type: "number", value: line.slice(i, j) });
      i = j;
      continue;
    }

    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < line.length && isIdentPart(line[j])) j++;
      const word = line.slice(i, j);
      const key = spec.caseInsensitiveKeywords ? word.toLowerCase() : word;
      if (spec.keywords.has(key)) {
        flushPlain();
        tokens.push({ type: "keyword", value: word });
      } else {
        plain += word;
      }
      i = j;
      continue;
    }

    plain += c;
    i++;
  }

  flushPlain();
  return { tokens, inBlock };
}

/** Highlights `code` for `language` (a fenced-code-block tag or a file
 *  extension — see `resolveLanguage`), returning one token array per line.
 *  An unrecognized or absent language returns every line as a single
 *  `"plain"` token, so callers never need a separate no-highlighting path. */
export function highlight(code: string, language?: string): Token[][] {
  const lang = resolveLanguage(language);
  const spec = lang ? LANGS[lang] : undefined;
  const lines = code.split("\n");
  if (!spec) return lines.map((line) => [{ type: "plain", value: line }]);

  let inBlock = false;
  return lines.map((line) => {
    const result = tokenizeLine(line, spec, inBlock);
    inBlock = result.inBlock;
    return result.tokens;
  });
}
