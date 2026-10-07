// @sverka/playground — shared engine plumbing. Browser-safe.
// Code template, user-code evaluation, and a timeout-wrapped run used by
// both the full playground app and the embeddable mountRunner.

import { Project, Pipeline, FunctionStep, Entry } from "./pipeline.js";
import { runPipeline } from "./runner.js";

/** Default template shown in the editor. */
export const DEFAULT_CODE = [
  'import { Project, Pipeline, FunctionStep, Entry } from "@sverka/playground";',
  "",
  'const proj = new Project("demo");',
  'const checks = new Pipeline(proj, "checks");',
  "",
  'new FunctionStep(checks, "lint", {',
  "  fn: () => [",
  '    { rule: "no-unused-vars", file: "src/index.ts", line: 5, severity: "high", message: "Variable \'x\' is declared but never used" },',
  '    { rule: "no-console", file: "src/utils.ts", line: 12, severity: "medium", message: "Unexpected console.log statement" },',
  "  ],",
  "});",
  "",
  'new FunctionStep(checks, "typecheck", {',
  "  fn: () => [",
  '    { rule: "ts2322", file: "src/types.ts", line: 8, severity: "critical", message: "Type \'string\' is not assignable to type \'number\'" },',
  "  ],",
  "});",
  "",
  'new FunctionStep(checks, "test", {',
  "  fn: () => [",
  '    { rule: "assertion-failed", file: "test/index.test.ts", line: 23, severity: "high", message: "Expected 5 but got 3" },',
  '    { rule: "assertion-failed", file: "test/index.test.ts", line: 45, severity: "low", message: "Expected \'hello\' but got \'world\'" },',
  "  ],",
  "});",
  "",
  'new Entry(checks, "on-push", { trigger: { kind: "push" }, roots: ["test"] });',
  "",
  "export default proj;",
  "",
].join("\n");

/** Escape HTML special characters to prevent XSS. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// Mini-scanner — same family as transpile.ts: char-class checks instead of
// regexes (a pattern on user source is ReDoS surface), and every helper is
// string/comment aware so quoted braces never count as syntax.
// ---------------------------------------------------------------------------

/** Identifier chars: `[A-Za-z0-9_$]`. */
function isIdentChar(c: string | undefined): boolean {
  if (c === undefined) return false;
  const n = c.charCodeAt(0);
  return (
    (n >= 48 && n <= 57) ||
    (n >= 65 && n <= 90) ||
    (n >= 97 && n <= 122) ||
    c === "_" ||
    c === "$"
  );
}

function isQuote(c: string | undefined): boolean {
  return c === '"' || c === "'" || c === "`";
}

/** True when `at` starts a `//` or `/*` comment. */
function commentAt(code: string, at: number): boolean {
  return code[at] === "/" && (code[at + 1] === "/" || code[at + 1] === "*");
}

/** Index of the `\n` ending the `//` comment at `at` (code.length if none). */
function lineCommentEnd(code: string, at: number): number {
  const end = code.indexOf("\n", at + 2);
  return end === -1 ? code.length : end;
}

/** Index just past the `*/ ` ending the `; /*` comment at `at`. */
function blockCommentEnd(code: string, at: number): number {
  const end = code.indexOf("*/", at + 2);
  return end === -1 ? code.length : end + 2;
}

/** End index of the `${` expression opened at `at` (inside a template).
 *  The expression itself can hold strings, comments, and nested templates:
 *  `` `${ x["`"] }` `` must not treat a quoted backtick as syntax. */
function scanTemplateExpr(code: string, at: number): number {
  let depth = 1;
  let i = at + 1;
  while (i < code.length && depth > 0) {
    const ch = code[i];
    if (isQuote(ch)) {
      i = scanString(code, i);
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      i = lineCommentEnd(code, i);
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      i = blockCommentEnd(code, i);
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return i;
}

/** End index of the string literal starting at `at` (quote char). */
function scanString(code: string, at: number): number {
  const quote = code[at];
  let i = at + 1;
  while (i < code.length) {
    const c = code[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === quote) return i + 1;
    // Template literals may nest `${}` expressions — track brace depth.
    if (quote === "`" && c === "$" && code[i + 1] === "{") {
      i = scanTemplateExpr(code, i + 2);
      continue;
    }
    i++;
  }
  return i;
}

/** End index of the opaque region at `i`, or i+1 for ordinary chars —
 *  and whether the region was a string literal. */
function scanOpaqueEnd(
  code: string,
  i: number,
): { end: number; isString: boolean } {
  const c = code[i];
  if (isQuote(c)) return { end: scanString(code, i), isString: true };
  if (c === "/" && code[i + 1] === "/")
    return { end: lineCommentEnd(code, i), isString: false };
  if (c === "/" && code[i + 1] === "*")
    return { end: blockCommentEnd(code, i), isString: false };
  return { end: i + 1, isString: false };
}

/** End index of the statement starting at `at`: first top-level `;`, or
 *  the first newline after the module-specifier string (covers multiline
 *  `import {…}\n from "x"` and `import "x"` without a semicolon). */
function scanStatementEnd(code: string, at: number): number {
  let i = at;
  let depth = 0;
  let specSeen = false;
  while (i < code.length) {
    const c = code[i];
    const opaque = scanOpaqueEnd(code, i);
    if (opaque.end > i + 1) {
      specSeen = specSeen || opaque.isString;
      i = opaque.end;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") depth++;
    else if (c === "}" || c === ")" || c === "]") depth--;
    else if (c === ";" && depth <= 0) return i + 1;
    else if (c === "\n" && depth <= 0 && specSeen) return i;
    i++;
  }
  return i;
}

function keywordAt(code: string, at: number, word: string): boolean {
  return code.startsWith(word, at) && !isIdentChar(code[at + word.length]);
}

function isTriviaWs(c: string | undefined): boolean {
  return c === " " || c === "\t" || c === "\r" || c === "\n";
}

/** Skip whitespace and comments (including newlines). */
function skipTrivia(code: string, at: number): number {
  let i = at;
  for (;;) {
    const c = code[i];
    if (isTriviaWs(c)) {
      i++;
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      i = lineCommentEnd(code, i);
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      i = blockCommentEnd(code, i);
      continue;
    }
    return i;
  }
}

/** Index of the `}` matching the `{` at `open`; code.length when unbalanced. */
function matchBrace(code: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const c = code[i];
    if (isQuote(c) || commentAt(code, i)) {
      i = scanOpaqueEnd(code, i).end;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return code.length;
}

/** Same-line statement tail: horizontal whitespace then an optional `;`.
 *  Never eats the newline — the following line is the next statement. */
function scanStmtTail(code: string, at: number): number {
  let i = at;
  while (i < code.length && (code[i] === " " || code[i] === "\t")) i++;
  if (code[i] === ";") i++;
  return i;
}

/** End index of the `from "…"` clause starting after `from`, or `at` when
 *  the clause is malformed — let the evaluator complain. */
function scanFromClause(code: string, next: number): number {
  const specAt = skipTrivia(code, next + 4);
  const q = code[specAt];
  if (q === '"' || q === "'") {
    return scanStmtTail(code, scanString(code, specAt));
  }
  return next;
}

/** End index of `export * [as ns] [from "…"]` — the `*` is at `at`. */
function scanExportStar(code: string, at: number): number {
  let i = skipTrivia(code, at + 1);
  if (keywordAt(code, i, "as")) {
    i = skipTrivia(code, i + 2);
    while (i < code.length && isIdentChar(code[i])) i++;
  }
  const next = skipTrivia(code, i);
  if (keywordAt(code, next, "from")) return scanFromClause(code, next);
  return scanStmtTail(code, i);
}

/**
 * End index of `export {…}` / `export * [as ns] [from "…"]` starting at
 * the `{` or `*`. A bare list ends at its `;` or newline — unlike an
 * import, a newline after the closing brace must end the statement or
 * the next line would be eaten with it.
 */
function scanExportListEnd(code: string, at: number): number {
  if (code[at] === "*") return scanExportStar(code, at);
  const i = matchBrace(code, at) + 1;
  const next = skipTrivia(code, i);
  if (keywordAt(code, next, "from")) return scanFromClause(code, next);
  return scanStmtTail(code, i);
}

interface ScanState {
  i: number;
  stmtStart: boolean;
  exportDefaultDone: boolean;
  /** `block` vs `expr` — separates block braces from object literals, so
   *  `{ export: 1 }` is a key, not a statement. */
  stack: ("block" | "expr")[];
}

function atStmtLevel(st: ScanState): boolean {
  return st.stack.length === 0 || st.stack[st.stack.length - 1] === "block";
}

/** Copy a string literal or comment verbatim into `out`. */
function copyOpaque(code: string, st: ScanState, out: string[]): boolean {
  const opaque = scanOpaqueEnd(code, st.i);
  if (opaque.end <= st.i + 1) return false;
  out.push(code.slice(st.i, opaque.end));
  if (opaque.isString) st.stmtStart = false;
  st.i = opaque.end;
  return true;
}

/** Handle `{}`/`()`/`[]` — pushes onto the block/expr stack. */
function applyBracket(code: string, st: ScanState, out: string[]): boolean {
  const c = code[st.i];
  if (c === "{") {
    // A `{` at statement position opens a block; anywhere else it's an
    // object literal. Inside a block the next token is a statement;
    // inside an object it's a key — `export:` there is not a keyword.
    st.stack.push(st.stmtStart ? "block" : "expr");
  } else if (c === "}") {
    // Closing a block ends the statement — closing an object literal
    // leaves the surrounding expression mid-flight.
    st.stmtStart = st.stack.pop() === "block";
  } else if (c === "(" || c === "[") {
    st.stack.push("expr");
    st.stmtStart = false;
  } else if (c === ")" || c === "]") {
    st.stack.pop();
    st.stmtStart = false;
  } else {
    return false;
  }
  out.push(c);
  st.i++;
  return true;
}

/** Handle `\n`, `;`, and horizontal whitespace — statement boundaries at
 *  statement level only (a `;` inside `for (;;)` doesn't count). */
function applyTerminator(code: string, st: ScanState, out: string[]): boolean {
  const c = code[st.i];
  if (c !== "\n" && c !== ";" && c !== " " && c !== "\t" && c !== "\r")
    return false;
  if ((c === "\n" || c === ";") && atStmtLevel(st)) st.stmtStart = true;
  out.push(c);
  st.i++;
  return true;
}

/** Handle an `import` keyword at statement start. Dynamic `import (…)`
 *  and `import.meta` pass through verbatim — whitespace and comments may
 *  sit between the keyword and the paren. */
function tryImport(code: string, st: ScanState, out: string[]): boolean {
  if (!st.stmtStart || !keywordAt(code, st.i, "import")) return false;
  const nc = code[skipTrivia(code, st.i + 6)];
  if (nc === "(" || nc === ".") {
    out.push("import");
    st.i += 6;
    st.stmtStart = false;
    return true;
  }
  st.i = scanStatementEnd(code, st.i + 6);
  st.stmtStart = false;
  return true;
}

/** Handle `export default` (→ `return`), `export {…}`/`export *` (removed)
 *  and `export <decl>` (keyword dropped — the eval context is a function
 *  body, where `export const` would be a syntax error). */
function tryExport(code: string, st: ScanState, out: string[]): boolean {
  if (!st.stmtStart || !keywordAt(code, st.i, "export")) return false;
  const j = skipTrivia(code, st.i + 6);
  if (
    !st.exportDefaultDone &&
    code.startsWith("default", j) &&
    !isIdentChar(code[j + 7])
  ) {
    // `return` must touch the expression — a newline between `default`
    // and the value would trigger ASI and return undefined.
    out.push("return ");
    st.exportDefaultDone = true;
    st.i = skipTrivia(code, j + 7);
    st.stmtStart = false;
    return true;
  }
  if (code[j] === "{" || code[j] === "*") {
    st.i = scanExportListEnd(code, j);
    st.stmtStart = false;
    return true;
  }
  st.i = j;
  st.stmtStart = false;
  return true;
}

/**
 * Strip import/export statements from user code for eval — a linear
 * single-pass scan, so multiline imports and comments/strings are handled
 * and pathological spacing cannot cause quadratic backtracking.
 *
 * `import …` statements are removed whole. `export default` becomes
 * `return`, `export {…}`/`export *` are removed, and `export` before a
 * declaration is dropped (the eval context is a function body, where
 * `export const` would be a syntax error).
 *
 * Note: TypeScript-specific syntax (type annotations, interfaces, enums)
 * is not stripped — the playground uses Monaco's TypeScript language mode
 * for editing, but evaluation is plain JavaScript. Users should write
 * JS-compatible code or use the `as any` escape hatch sparingly.
 */
export function preprocessCode(code: string): string {
  const out: string[] = [];
  const st: ScanState = {
    i: 0,
    stmtStart: true,
    exportDefaultDone: false,
    stack: [],
  };
  while (st.i < code.length) {
    if (code[st.i] === undefined) break;
    if (copyOpaque(code, st, out)) continue;
    if (applyBracket(code, st, out)) continue;
    if (applyTerminator(code, st, out)) continue;
    if (tryImport(code, st, out)) continue;
    if (tryExport(code, st, out)) continue;
    st.stmtStart = false;
    out.push(code[st.i] ?? "");
    st.i++;
  }
  return out.join("");
}

/**
 * Evaluate user code and return the Project.
 *
 * SECURITY: This uses `new Function()` to execute user-provided code.
 * This is intentional — the playground is a local development tool where
 * the user writes and runs their own pipeline code. The code runs in the
 * browser's main page context (not a sandboxed iframe or worker) because
 * the playground needs to support synchronous FunctionStep execution and
 * direct access to the pipeline constructs. This is the same trust model
 * as a local REPL or `node -e`.
 */
export function evaluateUserCode(code: string): Project {
  const processed = preprocessCode(code);
  // Dynamic code execution is intentional for the playground sandbox.
  // SonarCloud S1523: safe — user code runs in the browser sandbox with the
  // same trust model as a local REPL or `node -e` (see comment above).
  const params = ["Project", "Pipeline", "FunctionStep", "Entry", processed];
  // NOSONAR suppresses only issues on the marker's own line — it must
  // trail the `new Function` callee, not sit inside the argument list.
  const fn = new Function(...params); // NOSONAR — intentional dynamic evaluation in sandbox
  const result = fn(Project, Pipeline, FunctionStep, Entry); // NOSONAR
  if (!(result instanceof Project)) {
    throw new Error("Code must export a Project instance");
  }
  return result as Project;
}

/**
 * Run a pipeline with a timeout. If a step returns a never-resolving
 * promise, the timeout ensures the UI recovers instead of staying
 * stuck in "Running" state forever.
 */
export async function runPipelineWithTimeout(
  project: Project,
  timeoutMs: number,
): Promise<Awaited<ReturnType<typeof runPipeline>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runPipeline(project),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Pipeline timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    // Without this, every completed run leaves a live timer that rejects
    // into an unhandled rejection timeoutMs later.
    if (timer !== undefined) clearTimeout(timer);
  }
}
