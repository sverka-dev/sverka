// @sverka/playground — toSverkaConfig (Spec 53): the "take it home" bridge.
// Converts playground source into a real sverka.config.ts: the authoring
// surface (Project/Pipeline/Entry/roots) transfers verbatim — only the step
// kind differs. FunctionStep bodies cannot run as shell commands, so each
// becomes a ShellStep carrying a TODO echo the user replaces.

import { PlaygroundError } from "./share.js";

// ---------------------------------------------------------------------------
// Mini-scanner: every matcher below is string- and comment-aware, so braces
// inside comments or quotes never count as syntax, and a `\\` escape can
// never run past the end of input. All scans are linear.
// ---------------------------------------------------------------------------

const IDENT = /[A-Za-z0-9_$]/;

/** Index just past the string literal opening at `at`. */
function skipString(source: string, at: number): number {
  const quote = source[at];
  let i = at + 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    // Template literals nest `${}` expressions — track brace depth.
    if (quote === "`" && c === "$" && source[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < source.length && depth > 0) {
        if (source[i] === "{") depth++;
        else if (source[i] === "}") depth--;
        else if (source[i] === "`") {
          i = skipString(source, i);
          continue;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}

function skipLineComment(source: string, at: number): number {
  const end = source.indexOf("\n", at + 2);
  return end === -1 ? source.length : end;
}

function skipBlockComment(source: string, at: number): number {
  const end = source.indexOf("*/", at + 2);
  return end === -1 ? source.length : end + 2;
}

/** True when `at` starts a `//` or `/*` comment. */
function commentAt(source: string, at: number): boolean {
  return source[at] === "/" && (source[at + 1] === "/" || source[at + 1] === "*");
}

/** Advance past a string or comment, or return at+1 for ordinary chars. */
function skipOpaque(source: string, at: number): number {
  const c = source[at];
  if (c === '"' || c === "'" || c === "`") return skipString(source, at);
  if (source[at] === "/" && source[at + 1] === "/")
    return skipLineComment(source, at);
  if (source[at] === "/" && source[at + 1] === "*")
    return skipBlockComment(source, at);
  return at + 1;
}

/** Index of the `}` matching the `{` at `open`; -1 when unbalanced. */
function matchBrace(source: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`" || commentAt(source, i)) {
      i = skipOpaque(source, i);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Extract a top-level `key: <value>` span from a props object body.
 * Only depth-0 keys match — a `dependencies` declared inside `fn` never
 * counts. The value runs to the next top-level `,`, with strings,
 * comments, and nested brackets all balanced.
 */
function extractProp(props: string, key: string): string | undefined {
  let depth = 0;
  let i = 0;
  while (i < props.length) {
    const c = props[i];
    if (c === '"' || c === "'" || c === "`" || commentAt(props, i)) {
      i = skipOpaque(props, i);
      continue;
    }
    if (c === "{" || c === "[" || c === "(") {
      depth++;
      i++;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      depth--;
      i++;
      continue;
    }
    if (depth === 0 && IDENT.test(c ?? "")) {
      // Read the whole identifier, then compare — never a substring match.
      let wend = i;
      while (wend < props.length && IDENT.test(props[wend] ?? "")) wend++;
      const word = props.slice(i, wend);
      if (word === key) {
        let j = wend;
        while (j < props.length && /\s/.test(props[j] ?? "")) j++;
        if (props[j] === ":") {
          j++;
          while (j < props.length && /\s/.test(props[j] ?? "")) j++;
          // Value ends at the next top-level comma or at end of props.
          let valueDepth = 0;
          let k = j;
          while (k < props.length) {
            const v = props[k];
            if (v === '"' || v === "'" || v === "`" || commentAt(props, k)) {
              k = skipOpaque(props, k);
              continue;
            }
            if (v === "{" || v === "[" || v === "(") valueDepth++;
            else if (v === "}" || v === "]" || v === ")") valueDepth--;
            else if (v === "," && valueDepth === 0) break;
            k++;
          }
          return props.slice(j, k).trim();
        }
      }
      i = wend;
      continue;
    }
    i++;
  }
  return undefined;
}

/**
 * Rewrite `import {…} from "@sverka/playground"` statements linearly —
 * manual scanning instead of a global regex (a `[^}]*` pattern can do
 * quadratic work on inputs like `import{{import{{…`). Aliases survive:
 * `FunctionStep as Fn` becomes `ShellStep as Fn`.
 *
 * Returns the rewritten source plus every local name bound to
 * FunctionStep, so constructor calls under an alias are transpiled too.
 */
function rewritePlaygroundImports(source: string): {
  code: string;
  fnStepNames: string[];
} {
  const fnStepNames: string[] = [];
  let out = "";
  let cursor = 0;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '"' || c === "'" || c === "`" || commentAt(source, i)) {
      i = skipOpaque(source, i);
      continue;
    }
    if (!source.startsWith("import", i) || IDENT.test(source[i + 6] ?? "")) {
      i++;
      continue;
    }
    // import {…} from "…"
    let j = i + 6;
    while (j < source.length && /\s/.test(source[j] ?? "")) j++;
    if (source[j] !== "{") {
      i++;
      continue;
    }
    const namesEnd = matchBrace(source, j);
    if (namesEnd < 0) {
      i++;
      continue;
    }
    let k = namesEnd + 1;
    while (k < source.length && /\s/.test(source[k] ?? "")) k++;
    if (!source.startsWith("from", k) || IDENT.test(source[k + 4] ?? "")) {
      i++;
      continue;
    }
    k += 4;
    while (k < source.length && /\s/.test(source[k] ?? "")) k++;
    const q = source[k];
    if (q !== '"' && q !== "'") {
      i++;
      continue;
    }
    const specEnd = skipString(source, k);
    if (source.slice(k + 1, specEnd - 1) !== "@sverka/playground") {
      i++;
      continue;
    }
    // Consume the statement end (optional `;`).
    let stmtEnd = specEnd;
    while (stmtEnd < source.length && /\s/.test(source[stmtEnd] ?? ""))
      stmtEnd++;
    if (source[stmtEnd] === ";") stmtEnd++;

    const mapped = source
      .slice(j + 1, namesEnd)
      .split(",")
      .map((n) => n.trim())
      .filter((n) => n.length > 0)
      .map((n) => {
        const am = /^(\w+)\s+as\s+(\w+)$/.exec(n);
        const orig = am?.[1] ?? n;
        const local = am?.[2] ?? n;
        if (orig === "FunctionStep") {
          fnStepNames.push(local);
          return am ? `ShellStep as ${local}` : "ShellStep";
        }
        return n;
      });
    out += source.slice(cursor, i);
    out += `import { ${mapped.join(", ")} } from "@sverka/workflow"`;
    if (source[stmtEnd - 1] === ";") out += ";";
    cursor = stmtEnd;
    i = stmtEnd;
  }
  return { code: out + source.slice(cursor), fnStepNames };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Transpile playground source into `sverka.config.ts`.
 *
 * Rewrites the `@sverka/playground` import to `@sverka/workflow` and each
 * `new FunctionStep(scope, "id", { fn, dependencies })` into a ShellStep
 * whose command echoes a TODO — the function body has no shell equivalent.
 * `dependencies` maps onto `dependsOn`. Aliased FunctionStep imports
 * (`FunctionStep as Fn`) are followed too.
 *
 * Throws `PlaygroundError(TRANSPILE_FAILED)` naming the offending step when
 * a FunctionStep cannot be parsed — a half-converted file is never emitted.
 */
export function toSverkaConfig(source: string): string {
  // 1. Import rewrite — collects every local FunctionStep alias.
  const { code, fnStepNames } = rewritePlaygroundImports(source);
  let out = code;
  if (fnStepNames.length === 0) fnStepNames.push("FunctionStep");

  // 2. FunctionStep → ShellStep, props rewritten.
  const stepRe = new RegExp(
    `new\\s+(?:${fnStepNames.map(escapeRe).join("|")})` +
      `\\s*\\(\\s*([^,]+?)\\s*,\\s*(["'\`])([^"'\`]+)\\2\\s*,\\s*\\{`,
    "g",
  );
  let result = "";
  let cursor = 0;
  for (;;) {
    const m = stepRe.exec(out);
    if (!m) break;
    const [full, scope, quote, id] = m;
    if (
      quote === "`" ||
      id === undefined ||
      scope === undefined ||
      id.includes("${")
    ) {
      throw new PlaygroundError(
        "TRANSPILE_FAILED",
        `cannot parse FunctionStep "${id ?? "?"}" — template-literal or unsupported step id`,
      );
    }
    const propsOpen = m.index + full.length - 1; // index of '{'
    const propsClose = matchBrace(out, propsOpen);
    if (propsClose < 0) {
      throw new PlaygroundError(
        "TRANSPILE_FAILED",
        `cannot parse FunctionStep "${id}" — unbalanced props object`,
      );
    }
    const props = out.slice(propsOpen + 1, propsClose);
    const dependencies = extractProp(props, "dependencies");
    // The id lands inside shell single quotes — $()/backticks can never
    // expand. `'` is already impossible (the id regex excludes quotes).
    const todo =
      `new ShellStep(${scope}, "${id}", ` +
      `{ command: "echo 'TODO: port '${id}' — replace with the real shell command'"` +
      `${dependencies !== undefined ? `, dependsOn: ${dependencies}` : ""} }`;
    result += out.slice(cursor, m.index) + todo;
    cursor = propsClose + 1;
    stepRe.lastIndex = cursor;
  }
  out = result + out.slice(cursor);

  // A surviving step call means the regex matched nothing usable — e.g.
  // computed scope/id or an alias whose call is malformed. Fail loud
  // rather than emit a half-converted file.
  const leftoverRe = new RegExp(
    `new\\s+(?:${fnStepNames.map(escapeRe).join("|")})\\s*\\(\\s*([^,\\n]*)`,
  );
  const leftover = leftoverRe.exec(out);
  if (leftover) {
    throw new PlaygroundError(
      "TRANSPILE_FAILED",
      `cannot parse FunctionStep with scope '${leftover[1]?.trim() ?? "?"}' — unsupported expression`,
    );
  }

  return out;
}
