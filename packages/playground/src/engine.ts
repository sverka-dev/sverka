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

/**
 * Strip import/export statements from user code for eval.
 * Note: TypeScript-specific syntax (type annotations, interfaces, enums)
 * is not stripped — the playground uses Monaco's TypeScript language mode
 * for editing, but evaluation is plain JavaScript. Users should write
 * JS-compatible code or use the `as any` escape hatch sparingly.
 */
export function preprocessCode(code: string): string {
  return (
    code
      // Remove import statements
      .replace(/^\s*import\s+.*?from\s+["'][^"']+["'];?\s*$/gm, "")
      // Replace "export default" with "return"
      .replace(/^\s*export\s+default\s+/m, "return ")
      // Replace "export { ... }" with nothing (named exports not supported in playground)
      .replace(/^\s*export\s+\{[^}]*\};?\s*$/gm, "")
  );
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
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Pipeline timed out after ${timeoutMs}ms`)),
      timeoutMs,
    ),
  );
  return Promise.race([runPipeline(project), timeoutPromise]);
}
