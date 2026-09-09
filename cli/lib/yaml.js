// Minimal hand-written YAML reader/writer for `openagent.yaml` manifests.
//
// This is NOT a general-purpose YAML implementation. It supports exactly the
// subset used by the OpenAgents manifest format: block mappings, block and
// flow sequences, quoted/unquoted scalars, numbers, booleans, null, and
// simple inline comments. No anchors, no multiline block scalars (`|`/`>`),
// no flow mappings. That subset covers every `openagent.yaml` in this repo
// and everything `openagents init` generates.

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

/** Tokenize into {indent, content} for non-blank, non-full-comment lines. */
function tokenize(text) {
  const out = [];
  const rawLines = text.split(/\r\n|\n/);
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed === "---" || trimmed === "...") continue;
    out.push({ indent: indentOf(raw), content: trimmed });
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

function parseMappingFromDash(lines, i, dashIndent) {
  const contentIndent = dashIndent + 2;
  const map = {};
  const first = lines[i].content.slice(1).trim();
  let idx = i;
  const applyKV = (content) => {
    const { key, valStr } = splitKeyVal(content);
    if (valStr === "") {
      idx++;
      if (idx < lines.length && lines[idx].indent > dashIndent) {
        const [value, nextIdx] = parseNode(lines, idx, lines[idx].indent);
        map[key] = value;
        idx = nextIdx;
      } else {
        map[key] = null;
      }
    } else if (valStr === "[]") {
      map[key] = [];
      idx++;
    } else if (valStr.startsWith("[")) {
      map[key] = parseFlowList(valStr);
      idx++;
    } else {
      map[key] = parseScalar(valStr);
      idx++;
    }
  };
  applyKV(first);
  while (idx < lines.length && lines[idx].indent === contentIndent && !isSeqLine(lines[idx].content)) {
    applyKV(lines[idx].content);
  }
  return [map, idx];
}

function parseSequence(lines, i, indent) {
  const arr = [];
  let idx = i;
  while (idx < lines.length && lines[idx].indent === indent && isSeqLine(lines[idx].content)) {
    const itemContent = lines[idx].content.slice(1).trim();
    if (itemContent === "") {
      const [value, nextIdx] = parseNode(lines, idx + 1, indent + 2);
      arr.push(value);
      idx = nextIdx;
    } else if (findKeyColon(itemContent) !== -1) {
      const [value, nextIdx] = parseMappingFromDash(lines, idx, indent);
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

function parseMapping(lines, i, indent) {
  const map = {};
  let idx = i;
  while (idx < lines.length && lines[idx].indent === indent && !isSeqLine(lines[idx].content)) {
    const { key, valStr } = splitKeyVal(lines[idx].content);
    if (valStr === "") {
      const next = lines[idx + 1];
      if (next && next.indent > indent) {
        const [value, nextIdx] = parseNode(lines, idx + 1, next.indent);
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
      map[key] = parseScalar(valStr);
      idx++;
    }
  }
  return [map, idx];
}

function parseNode(lines, i, indent) {
  if (i >= lines.length) return [null, i];
  let useIndent = indent;
  if (lines[i].indent !== indent) {
    if (lines[i].indent < indent) return [null, i];
    useIndent = lines[i].indent;
  }
  if (isSeqLine(lines[i].content)) {
    return parseSequence(lines, i, useIndent);
  }
  return parseMapping(lines, i, useIndent);
}

/** Parse YAML text (the OpenAgents manifest subset) into a plain JS value. */
export function parseYaml(text) {
  const lines = tokenize(text);
  if (lines.length === 0) return {};
  const [value] = parseNode(lines, 0, lines[0].indent);
  return value;
}
