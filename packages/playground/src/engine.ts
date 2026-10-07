// @sverka/playground — shared engine plumbing. Browser-safe.
// Code template, user-code evaluation, and a timeout-wrapped run used by
// both the full playground app and the embeddable mountRunner.

import {
  Project,
  Pipeline,
  FunctionStep,
  ShellStep,
  Entry,
} from "./pipeline.js";
import { runPipeline } from "./runner.js";
import {
  commentAt,
  isIdentChar,
  isWsChar,
  keywordAt,
  matchBrace,
  operandAfterWord,
  scanOpaqueEnd,
  scanRegex,
  scanString,
  skipIdent,
  skipTrivia,
} from "./scanner.js";

/** Trigger helpers mirroring @sverka/workflow — real configs use
 *  `trigger: push()`/`manual()`/`schedule()`/`changeRequest()`. The
 *  optional filter argument is preserved, not silently discarded —
 *  `push({ branches: ["main"] })` keeps its restriction. */
const push = (filter?: Record<string, unknown>) => ({
  kind: "push",
  ...filter,
});
const changeRequest = (filter?: Record<string, unknown>) => ({
  kind: "changeRequest",
  ...filter,
});
const manual = (filter?: Record<string, unknown>) => ({
  kind: "manual",
  ...filter,
});
const schedule = (cron: string, timezone?: string) => ({
  kind: "schedule",
  cron,
  ...(timezone ? { timezone } : {}),
});

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

/** +1/−1 for bracket chars, 0 otherwise. */
function bracketDelta(c: string | undefined): number {
  if (c === "{" || c === "(" || c === "[") return 1;
  if (c === "}" || c === ")" || c === "]") return -1;
  return 0;
}

/** Chars that end an import statement at depth ≤0: `;` (consumed) or a
 *  newline after the module-specifier string (left in place). */
function stmtTerminator(
  c: string | undefined,
  depth: number,
  specSeen: boolean,
): "past" | "at" | null {
  if (c === ";" && depth <= 0) return "past";
  if (c === "\n" && depth <= 0 && specSeen) return "at";
  return null;
}

/** End index of the statement starting at `at`: first top-level `;`, or
 *  the first newline after the module-specifier string (covers multiline
 *  `import {…}\n from "x"` and `import "x"` without a semicolon). */
function scanStatementEnd(code: string, at: number): number {
  let i = at;
  let depth = 0;
  let specSeen = false;
  while (i < code.length) {
    const opaque = scanOpaqueEnd(code, i);
    if (opaque.end > i + 1) {
      specSeen = specSeen || opaque.isString;
      i = opaque.end;
      continue;
    }
    const term = stmtTerminator(code[i], depth, specSeen);
    if (term === "past") return i + 1;
    if (term === "at") return i;
    depth += bracketDelta(code[i]);
    i++;
  }
  return i;
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
    i = skipIdent(code, i);
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
  const close = matchBrace(code, at);
  const i = close < 0 ? code.length : close + 1;
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
  /** True when the previous token ended an operand — `/` then divides.
   *  Regex literals never update the delimiter stack, so `/[{]/` can't
   *  leave an unclosed `{` that keeps `export default` alive to eval. */
  operandEnd: boolean;
}

function atStmtLevel(st: ScanState): boolean {
  return st.stack.length === 0 || st.stack.at(-1) === "block";
}

/** Copy a string literal or comment verbatim into `out`. */
function copyOpaque(code: string, st: ScanState, out: string[]): boolean {
  const opaque = scanOpaqueEnd(code, st.i);
  if (opaque.end <= st.i + 1) return false;
  out.push(code.slice(st.i, opaque.end));
  if (opaque.isString) {
    st.stmtStart = false;
    st.operandEnd = true;
  }
  st.i = opaque.end;
  return true;
}

/** Handle `{}`/`()`/`[]` — pushes onto the block/expr stack and sets the
 *  operand context: `}` closing an object literal ends a value, `}`
 *  closing a block ends a statement. */
function applyBracket(code: string, st: ScanState, out: string[]): boolean {
  const c = code[st.i];
  if (c === "{") {
    // A `{` at statement position opens a block; anywhere else it's an
    // object literal. Inside a block the next token is a statement;
    // inside an object it's a key — `export:` there is not a keyword.
    st.stack.push(st.stmtStart ? "block" : "expr");
    st.operandEnd = false;
  } else if (c === "}") {
    const popped = st.stack.pop();
    st.stmtStart = popped === "block";
    st.operandEnd = popped === "expr";
  } else if (c === "(" || c === "[") {
    st.stack.push("expr");
    st.stmtStart = false;
    st.operandEnd = false;
  } else if (c === ")" || c === "]") {
    st.stack.pop();
    st.stmtStart = false;
    st.operandEnd = true;
  } else {
    return false;
  }
  out.push(c ?? "");
  st.i++;
  return true;
}

/** Handle `\n`, `;`, and whitespace — statement boundaries at statement
 *  level only (a `;` inside `for (;;)` doesn't count). A newline never
 *  resets operand context: `foo\n/bar/` divides, per ASI rules. */
function applyTerminator(code: string, st: ScanState, out: string[]): boolean {
  const c = code[st.i];
  if (c !== ";" && c !== "\n" && !isWsChar(c)) return false;
  if (c === ";") {
    if (atStmtLevel(st)) st.stmtStart = true;
    st.operandEnd = false;
  } else if (c === "\n" && atStmtLevel(st)) {
    st.stmtStart = true;
  }
  out.push(c ?? "");
  st.i++;
  return true;
}

/** Handle `/` — a regex literal when an operand is expected, a division
 *  operator when one just ended. Comments never reach here (copyOpaque
 *  already consumed them). */
function applySlash(code: string, st: ScanState, out: string[]): boolean {
  if (code[st.i] !== "/" || commentAt(code, st.i)) return false;
  if (st.operandEnd) {
    out.push("/");
    st.i++;
    st.operandEnd = false;
  } else {
    const end = scanRegex(code, st.i);
    out.push(code.slice(st.i, end));
    st.i = end;
    st.operandEnd = true;
  }
  st.stmtStart = false;
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
    st.operandEnd = true;
    return true;
  }
  st.i = scanStatementEnd(code, st.i + 6);
  st.stmtStart = false;
  st.operandEnd = false;
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
    st.operandEnd = false;
    return true;
  }
  if (code[j] === "{" || code[j] === "*") {
    st.i = scanExportListEnd(code, j);
    st.stmtStart = false;
    st.operandEnd = false;
    return true;
  }
  st.i = j;
  st.stmtStart = false;
  st.operandEnd = false;
  return true;
}

/** Emit an identifier run — keyword table decides whether `/` after it
 *  divides (`foo /x/`) or opens a regex (`return /x/`). */
function tryWord(code: string, st: ScanState, out: string[]): boolean {
  if (!isIdentChar(code[st.i])) return false;
  const wend = skipIdent(code, st.i);
  out.push(code.slice(st.i, wend));
  st.operandEnd = operandAfterWord(code.slice(st.i, wend));
  st.stmtStart = false;
  st.i = wend;
  return true;
}

/** Char handlers tried in order — first true wins. Any char left over is
 *  copied verbatim as a non-operand punctuation token. */
const HANDLERS: ((code: string, st: ScanState, out: string[]) => boolean)[] = [
  copyOpaque,
  applyBracket,
  applyTerminator,
  applySlash,
  tryImport,
  tryExport,
  tryWord,
];

function advanceScan(code: string, st: ScanState, out: string[]): void {
  for (const handle of HANDLERS) {
    if (handle(code, st, out)) return;
  }
  st.stmtStart = false;
  st.operandEnd = false;
  out.push(code[st.i] ?? "");
  st.i++;
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
    operandEnd: false,
  };
  while (st.i < code.length) {
    if (code[st.i] === undefined) break;
    advanceScan(code, st, out);
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
  const params = [
    "Project",
    "Pipeline",
    "FunctionStep",
    "ShellStep",
    "Entry",
    "push",
    "changeRequest",
    "manual",
    "schedule",
    processed,
  ];
  // NOSONAR suppresses only issues on the marker's own line — it must
  // trail the `new Function` callee, not sit inside the argument list.
  const fn = new Function(...params); // NOSONAR — intentional dynamic evaluation in sandbox
  // NOSONAR anchors per line — the invocation line carries it too.
  const result = fn(
    // NOSONAR — intentional dynamic evaluation in sandbox
    Project,
    Pipeline,
    FunctionStep,
    ShellStep,
    Entry,
    push,
    changeRequest,
    manual,
    schedule,
  );
  if (!(result instanceof Project)) {
    throw new TypeError("Code must export a Project instance");
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
