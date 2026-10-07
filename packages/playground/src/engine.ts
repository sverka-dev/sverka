// @sverka/playground — shared engine plumbing. Browser-safe.
// Code template, user-code evaluation, and a timeout-wrapped run used by
// both the full playground app and the embeddable mountRunner.

import { Project, Pipeline, FunctionStep, Entry } from "./pipeline.js";
import { runPipeline } from "./runner.js";

/** Default template shown in the editor. */
export const DEFAULT_CODE = `import { Project, Pipeline, FunctionStep, Entry } from "@sverka/playground";

const proj = new Project("demo");
const checks = new Pipeline(proj, "checks");

new FunctionStep(checks, "lint", {
  fn: () => [
    { rule: "no-unused-vars", file: "src/index.ts", line: 5, severity: "high", message: "Variable 'x' is declared but never used" },
    { rule: "no-console", file: "src/utils.ts", line: 12, severity: "medium", message: "Unexpected console.log statement" },
  ],
});

new FunctionStep(checks, "typecheck", {
  fn: () => [
    { rule: "ts2322", file: "src/types.ts", line: 8, severity: "critical", message: "Type 'string' is not assignable to type 'number'" },
  ],
});

new FunctionStep(checks, "test", {
  fn: () => [
    { rule: "assertion-failed", file: "test/index.test.ts", line: 23, severity: "high", message: "Expected 5 but got 3" },
    { rule: "assertion-failed", file: "test/index.test.ts", line: 45, severity: "low", message: "Expected 'hello' but got 'world'" },
  ],
});

new Entry(checks, "on-push", { trigger: { kind: "push" }, roots: ["test"] });

export default proj;
`;

/** Escape HTML special characters to prevent XSS. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const IDENT = /[A-Za-z0-9_$]/;

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
    // The expression itself can hold strings, comments, and nested
    // templates: `` `${ x["`"] }` `` must not treat a quoted backtick
    // as syntax.
    if (quote === "`" && c === "$" && code[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < code.length && depth > 0) {
        const ch = code[i];
        if (ch === '"' || ch === "'" || ch === "`") {
          i = scanString(code, i);
          continue;
        }
        if (ch === "/" && code[i + 1] === "/") {
          const end = code.indexOf("\n", i + 2);
          i = end === -1 ? code.length : end;
          continue;
        }
        if (ch === "/" && code[i + 1] === "*") {
          const end = code.indexOf("*/", i + 2);
          i = end === -1 ? code.length : end + 2;
          continue;
        }
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
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
    if (c === '"' || c === "'" || c === "`") {
      i = scanString(code, i);
      specSeen = true;
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      while (i < code.length && code[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
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
  return code.startsWith(word, at) && !IDENT.test(code[at + word.length] ?? "");
}

/** Skip whitespace and comments (including newlines). */
function skipTrivia(code: string, at: number): number {
  let i = at;
  for (;;) {
    const c = code[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i++;
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i + 2);
      i = end === -1 ? code.length : end;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
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
    if (c === '"' || c === "'" || c === "`") {
      i = scanString(code, i);
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i + 2);
      i = end === -1 ? code.length : end;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
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

/**
 * End index of `export {…}` / `export * [as ns] [from "…"]` starting at
 * the `{` or `*`. A bare list ends at its `;` or newline — unlike an
 * import, a newline after the closing brace must end the statement or
 * the next line would be eaten with it.
 */
function scanExportListEnd(code: string, at: number): number {
  let i = at;
  if (code[i] === "{") {
    i = matchBrace(code, i) + 1;
  } else {
    i++; // `*`
    i = skipTrivia(code, i);
    if (keywordAt(code, i, "as")) {
      i = skipTrivia(code, i + 2);
      while (i < code.length && IDENT.test(code[i] ?? "")) i++;
    }
  }
  const next = skipTrivia(code, i);
  if (keywordAt(code, next, "from")) {
    const specAt = skipTrivia(code, next + 4);
    const q = code[specAt];
    if (q === '"' || q === "'") {
      return scanStmtTail(code, scanString(code, specAt));
    }
    return next; // malformed — let the evaluator complain
  }
  return scanStmtTail(code, i);
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
  let i = 0;
  const n = code.length;
  // `stmtStart` — the next token may begin a statement, so `import`/
  // `export` count only here (never mid-expression: `import()` and
  // `import.meta` are left untouched). A brace stack separates blocks
  // from object literals — `{ export: 1 }` is a key, not a statement.
  const stack: ("block" | "expr")[] = [];
  const atStmtLevel = (): boolean =>
    stack.length === 0 || stack[stack.length - 1] === "block";
  let stmtStart = true;
  let exportDefaultDone = false;

  while (i < n) {
    const c = code[i];
    if (c === undefined) break;
    if (c === '"' || c === "'" || c === "`") {
      const end = scanString(code, i);
      out.push(code.slice(i, end));
      stmtStart = false;
      i = end;
      continue;
    }
    if (c === "/" && code[i + 1] === "/") {
      const end = code.indexOf("\n", i + 2);
      const stop = end === -1 ? n : end;
      out.push(code.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? n : end + 2;
      out.push(code.slice(i, stop));
      i = stop;
      continue;
    }
    if (c === "{") {
      // A `{` at statement position opens a block; anywhere else it's an
      // object literal. Inside a block the next token is a statement;
      // inside an object it's a key — `export:` there is not a keyword.
      stack.push(stmtStart ? "block" : "expr");
      out.push(c);
      i++;
      continue;
    }
    if (c === "}") {
      // Closing a block ends the statement — closing an object literal
      // leaves the surrounding expression mid-flight.
      stmtStart = stack.pop() === "block";
      out.push(c);
      i++;
      continue;
    }
    if (c === "(" || c === "[") {
      stack.push("expr");
      stmtStart = false;
      out.push(c);
      i++;
      continue;
    }
    if (c === ")" || c === "]") {
      stack.pop();
      stmtStart = false;
      out.push(c);
      i++;
      continue;
    }
    if (c === "\n" || c === ";") {
      // Statement boundary only at statement level — a `;` inside
      // `for (;;)` or a newline inside an object literal doesn't count.
      if (atStmtLevel()) stmtStart = true;
      out.push(c);
      i++;
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      out.push(c);
      i++;
      continue;
    }
    if (stmtStart && keywordAt(code, i, "import")) {
      const next = skipTrivia(code, i + 6);
      const nc = code[next];
      // `import (…)` is a dynamic-import expression and `import.meta` is
      // meta — whitespace and comments may sit between the keyword and
      // the paren. Anything else is a static import statement.
      if (nc === "(" || nc === ".") {
        out.push("import");
        i += 6;
        stmtStart = false;
        continue;
      }
      i = scanStatementEnd(code, i + 6);
      stmtStart = false;
      continue;
    }
    if (stmtStart && keywordAt(code, i, "export")) {
      const j = skipTrivia(code, i + 6);
      if (
        !exportDefaultDone &&
        code.startsWith("default", j) &&
        !IDENT.test(code[j + 7] ?? "")
      ) {
        // `return` must touch the expression — a newline between
        // `default` and the value would trigger ASI and return
        // undefined.
        out.push("return ");
        exportDefaultDone = true;
        i = skipTrivia(code, j + 7);
        stmtStart = false;
        continue;
      }
      if (code[j] === "{" || code[j] === "*") {
        i = scanExportListEnd(code, j);
        stmtStart = false;
        continue;
      }
      // `export <decl>` — drop the keyword, keep the declaration.
      i = j;
      stmtStart = false;
      continue;
    }
    stmtStart = false;
    out.push(c);
    i++;
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
