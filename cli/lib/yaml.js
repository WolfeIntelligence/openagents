// Minimal hand-written YAML reader/writer for `openagent.yaml` manifests.
//
// This is NOT a general-purpose YAML implementation. It supports exactly the
// subset used by the OpenAgents manifest format: block mappings, block and
// flow sequences, quoted/unquoted scalars, numbers, booleans, null, simple
// inline comments, and literal/folded block scalars (`|`, `|-`, `|+`, `>`,
// `>-`, `>+`). No anchors, no flow mappings, no explicit block-scalar
// indentation indicators (`|2`). That subset covers every `openagent.yaml`
// in this repo and everything `openagents init` generates.
//
// Anything outside the subset is rejected with a readable error rather than
// silently mangled: tab indentation, and an unquoted plain scalar containing
// ": " (which real YAML parses as a nested compact mapping, not a string).

/** Find the index of the first unquoted top-level colon in `line`, or -1. */
function findKeyColon(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (quote === '"' && ch === "\\") {
        i++; // skip escaped char
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ":" && (i === line.length - 1 || line[i + 1] === " ")) {
      return i;
    }
  }
  return -1;
}

/** Strip a trailing ` # comment` from an unquoted-or-post-quote position. */
function stripInlineComment(s) {
  const trimmed = s.trim();
  if (trimmed.startsWith('"')) {
    // find the matching close quote, then look for a comment after it
    let i = 1;
    while (i < trimmed.length) {
      if (trimmed[i] === "\\") {
        i += 2;
        continue;
      }
      if (trimmed[i] === '"') {
        i++;
        break;
      }
      i++;
    }
    const rest = trimmed.slice(i);
    const hashIdx = rest.indexOf(" #");
    return hashIdx === -1 ? trimmed : trimmed.slice(0, i) + rest.slice(0, hashIdx);
  }
  if (trimmed.startsWith("'")) {
    const closeIdx = trimmed.indexOf("'", 1);
    if (closeIdx === -1) return trimmed;
    const rest = trimmed.slice(closeIdx + 1);
    const hashIdx = rest.indexOf(" #");
    return hashIdx === -1 ? trimmed : trimmed.slice(0, closeIdx + 1) + rest.slice(0, hashIdx);
  }
  const hashIdx = trimmed.indexOf(" #");
  return hashIdx === -1 ? trimmed : trimmed.slice(0, hashIdx);
}

function parseScalar(raw) {
  const s = stripInlineComment(raw).trim();
  if (s === "" || s === "~" || s === "null" || s === "Null" || s === "NULL") return null;
  if (s === "true" || s === "True" || s === "TRUE") return true;
  if (s === "false" || s === "False" || s === "FALSE") return false;
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    return s
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\");
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
  return s;
}

/**
 * Reject a plain (unquoted) scalar value that contains an unquoted ": " —
 * real YAML parses that as a nested compact mapping in this position, which
 * this parser does not support, and silently returning the raw string (the
 * old behaviour) lets the CLI accept manifests the server's real YAML parser
 * rejects. Also rejects a plain scalar that is only a dangling key (ends in
 * an unquoted ":").
 */
function assertSafePlainScalar(key, valStr) {
  const trimmed = valStr.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return;
  if (findKeyColon(trimmed) !== -1) {
    throw new Error(
      `${key}: value "${trimmed}" contains ": " which YAML reads as a nested mapping here — quote the value`
    );
  }
  if (trimmed.endsWith(":")) {
    throw new Error(`${key}: value "${trimmed}" ends in ":" which YAML reads as a mapping key — quote the value`);
  }
}

function parseFlowList(s) {
  const inner = s.trim().slice(1, -1).trim();
  if (inner === "") return [];
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "[" || ch === "{") depth++;
    if (ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== "") parts.push(cur);
  return parts.map((p) => parseScalar(p));
}

function indentOf(line) {
  let n = 0;
  while (n < line.length && line[n] === " ") n++;
  return n;
}

/** True if `raw`'s leading indentation contains a tab character anywhere. */
function leadingWhitespaceHasTab(raw) {
  let i = 0;
  while (i < raw.length && (raw[i] === " " || raw[i] === "\t")) i++;
  return raw.slice(0, i).includes("\t");
}

/** Tokenize into {indent, content, rawIndex} for non-blank, non-full-comment lines. */
function tokenize(rawLines) {
  const out = [];
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (raw.trim() === "") continue;
    if (leadingWhitespaceHasTab(raw)) {
      throw new Error(`tab indentation is not supported (line ${i + 1}): use spaces`);
    }
    const trimmed = raw.trim();
    if (trimmed.startsWith("#")) continue;
    if (trimmed === "---" || trimmed === "...") continue;
    out.push({ indent: indentOf(raw), content: trimmed, rawIndex: i });
  }
  return out;
}

function splitKeyVal(content) {
  const colonIdx = findKeyColon(content);
  if (colonIdx === -1) {
    return { key: content.trim(), valStr: "" };
  }
  return {
    key: content.slice(0, colonIdx).trim(),
    valStr: content.slice(colonIdx + 1).trim(),
  };
}

function isSeqLine(content) {
  return content === "-" || content.startsWith("- ");
}

/** Returns the block-scalar indicator ("|", "|-", "|+", ">", ">-", ">+") if `str` is exactly one, else null. */
function blockScalarIndicator(str) {
  const s = stripInlineComment(str).trim();
  return /^[|>][+-]?$/.test(s) ? s : null;
}

/**
 * Fold a literal-scalar-style array of de-indented lines per YAML's folding
 * rules for `>`: blank lines and more-indented lines force a line break;
 * otherwise adjacent non-blank lines are joined with a single space.
 */
function foldLines(lines) {
  let result = "";
  let first = true;
  let prevBlank = false;
  let prevMoreIndented = false;
  for (const line of lines) {
    const isBlank = line === "";
    const isMoreIndented = !isBlank && line[0] === " ";
    if (first) {
      result += line;
    } else if (isBlank) {
      // A blank line always contributes its own line break; it also fully
      // accounts for the break before whatever follows it, so no separator
      // is added when we resume with the next line (see the `prevBlank`
      // branch below).
      result += "\n";
    } else if (prevBlank) {
      result += line;
    } else if (prevMoreIndented || isMoreIndented) {
      result += "\n" + line;
    } else {
      result += " " + line;
    }
    prevBlank = isBlank;
    prevMoreIndented = isMoreIndented;
    first = false;
  }
  return result;
}

/**
 * Read a block scalar body starting at `rawLines[fromRawIdx]`, whose parent
 * key/dash sits at `parentIndent`. Returns { value, nextRawIdx } where
 * `nextRawIdx` is the raw-line index immediately after the consumed block
 * (exclusive), for the caller to resume tokenized parsing from.
 */
function readBlockScalar(rawLines, fromRawIdx, parentIndent, indicator) {
  const style = indicator[0];
  const chomp = indicator.length > 1 ? indicator[1] : null;

  let blockIndent = null;
  for (let j = fromRawIdx; j < rawLines.length; j++) {
    if (rawLines[j].trim() === "") continue;
    const ind = indentOf(rawLines[j]);
    if (ind <= parentIndent) break;
    blockIndent = ind;
    break;
  }

  if (blockIndent === null) {
    return { value: "", nextRawIdx: fromRawIdx };
  }

  const collected = [];
  let k = fromRawIdx;
  for (; k < rawLines.length; k++) {
    const raw = rawLines[k];
    if (raw.trim() === "") {
      collected.push("");
      continue;
    }
    const ind = indentOf(raw);
    if (ind < blockIndent) break;
    collected.push(raw.slice(blockIndent));
  }

  let trailingBlanks = 0;
  while (collected.length && collected[collected.length - 1] === "") {
    collected.pop();
    trailingBlanks++;
  }

  const core = style === "|" ? collected.join("\n") : foldLines(collected);

  let value;
  if (chomp === "-") {
    value = core;
  } else if (chomp === "+") {
    value = core + (core.length ? "\n" : "") + "\n".repeat(trailingBlanks);
  } else {
    value = core + (core.length ? "\n" : "");
  }

  return { value, nextRawIdx: k };
}

/** First index in `lines` (tokens) whose rawIndex is >= `rawIdx`, scanning from `fromIdx`. */
function tokenIndexAtOrAfterRaw(lines, rawIdx, fromIdx) {
  let idx = fromIdx;
  while (idx < lines.length && lines[idx].rawIndex < rawIdx) idx++;
  return idx;
}

function parseMappingFromDash(lines, rawLines, i, dashIndent) {
  const contentIndent = dashIndent + 2;
  const map = {};
  const first = lines[i].content.slice(1).trim();
  let idx = i;

  const applyKV = (content, tokenIdx) => {
    const { key, valStr } = splitKeyVal(content);
    const indicator = blockScalarIndicator(valStr);
    if (indicator) {
      const { value, nextRawIdx } = readBlockScalar(
        rawLines,
        lines[tokenIdx].rawIndex + 1,
        lines[tokenIdx].indent,
        indicator
      );
      map[key] = value;
      idx = tokenIndexAtOrAfterRaw(lines, nextRawIdx, tokenIdx + 1);
      return;
    }
    if (valStr === "") {
      const next = lines[tokenIdx + 1];
      if (next && next.indent > dashIndent) {
        const [value, nextIdx] = parseNode(lines, rawLines, tokenIdx + 1, next.indent);
        map[key] = value;
        idx = nextIdx;
      } else {
        map[key] = null;
        idx = tokenIdx + 1;
      }
    } else if (valStr === "[]") {
      map[key] = [];
      idx = tokenIdx + 1;
    } else if (valStr.startsWith("[")) {
      map[key] = parseFlowList(valStr);
      idx = tokenIdx + 1;
    } else {
      assertSafePlainScalar(key, valStr);
      map[key] = parseScalar(valStr);
      idx = tokenIdx + 1;
    }
  };

  applyKV(first, i);
  while (idx < lines.length && lines[idx].indent === contentIndent && !isSeqLine(lines[idx].content)) {
    applyKV(lines[idx].content, idx);
  }
  return [map, idx];
}

function parseSequence(lines, rawLines, i, indent) {
  const arr = [];
  let idx = i;
  while (idx < lines.length && lines[idx].indent === indent && isSeqLine(lines[idx].content)) {
    const itemContent = lines[idx].content.slice(1).trim();
    const indicator = blockScalarIndicator(itemContent);
    if (indicator) {
      const { value, nextRawIdx } = readBlockScalar(rawLines, lines[idx].rawIndex + 1, indent, indicator);
      arr.push(value);
      idx = tokenIndexAtOrAfterRaw(lines, nextRawIdx, idx + 1);
    } else if (itemContent === "") {
      const [value, nextIdx] = parseNode(lines, rawLines, idx + 1, indent + 2);
      arr.push(value);
      idx = nextIdx;
    } else if (findKeyColon(itemContent) !== -1) {
      const [value, nextIdx] = parseMappingFromDash(lines, rawLines, idx, indent);
      arr.push(value);
      idx = nextIdx;
    } else if (itemContent.startsWith("[")) {
      arr.push(parseFlowList(itemContent));
      idx++;
    } else {
      arr.push(parseScalar(itemContent));
      idx++;
    }
  }
  return [arr, idx];
}

function parseMapping(lines, rawLines, i, indent) {
  const map = {};
  let idx = i;
  while (idx < lines.length && lines[idx].indent === indent && !isSeqLine(lines[idx].content)) {
    const { key, valStr } = splitKeyVal(lines[idx].content);
    const indicator = blockScalarIndicator(valStr);
    if (indicator) {
      const { value, nextRawIdx } = readBlockScalar(rawLines, lines[idx].rawIndex + 1, lines[idx].indent, indicator);
      map[key] = value;
      idx = tokenIndexAtOrAfterRaw(lines, nextRawIdx, idx + 1);
    } else if (valStr === "") {
      const next = lines[idx + 1];
      if (next && next.indent > indent) {
        const [value, nextIdx] = parseNode(lines, rawLines, idx + 1, next.indent);
        map[key] = value;
        idx = nextIdx;
      } else {
        map[key] = null;
        idx++;
      }
    } else if (valStr === "[]" || valStr === "{}") {
      map[key] = valStr === "[]" ? [] : {};
      idx++;
    } else if (valStr.startsWith("[")) {
      map[key] = parseFlowList(valStr);
      idx++;
    } else {
      assertSafePlainScalar(key, valStr);
      map[key] = parseScalar(valStr);
      idx++;
    }
  }
  return [map, idx];
}

function parseNode(lines, rawLines, i, indent) {
  if (i >= lines.length) return [null, i];
  let useIndent = indent;
  if (lines[i].indent !== indent) {
    if (lines[i].indent < indent) return [null, i];
    useIndent = lines[i].indent;
  }
  if (isSeqLine(lines[i].content)) {
    return parseSequence(lines, rawLines, i, useIndent);
  }
  return parseMapping(lines, rawLines, i, useIndent);
}

/**
 * Format a scalar for the manifest writer (`openagents init`): quotes it
 * when writing it bare would either be misparsed (colons, YAML indicator
 * characters, values that look like a number/bool/null) or rejected by
 * `parseYaml`'s nested-colon check above.
 */
export function formatYamlScalar(value) {
  const s = String(value);
  const needsQuoting =
    s === "" ||
    /^\s|\s$/.test(s) ||
    /: |:$| #/.test(s) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /^(true|false|null|~|[-+]?\d+(\.\d+)?)$/i.test(s);
  if (!needsQuoting) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Parse YAML text (the OpenAgents manifest subset) into a plain JS value. */
export function parseYaml(text) {
  const rawLines = text.split(/\r\n|\n/);
  // A trailing newline at EOF produces one spurious empty element from
  // split(); drop it so it isn't mistaken for a genuine trailing blank line
  // inside a block scalar's chomping calculation.
  if (rawLines.length > 1 && rawLines[rawLines.length - 1] === "") rawLines.pop();
  const lines = tokenize(rawLines);
  if (lines.length === 0) return {};
  const [value] = parseNode(lines, rawLines, 0, lines[0].indent);
  return value;
}
