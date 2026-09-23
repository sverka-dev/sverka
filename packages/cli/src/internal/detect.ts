// Shared project-check detection for `init --detect` and `sverka check`.
//
// Combines two sources:
// - planner discovery (ecosystem-aware: cargo, go, ruff, package managers) —
//   requires a git repository, degrades gracefully when unavailable
// - package.json script scanning — ground truth for JS/TS projects
//
// Planner-proposed `<pm> run <script>` steps are filtered against the
// scripts that actually exist so generated configs never reference
// missing scripts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createPlanner } from "@sverka/sdk";
import {
  createBuiltinResolver,
  synthesizeCheckSteps,
} from "@sverka/verification";
import { detectPackageManager } from "./config.js";

/** A detected check ready to become a ShellStep. */
export interface DetectedCheck {
  /** Step id, e.g. "lint". */
  checkId: string;
  /** Shell command, e.g. "bun run lint". */
  command: string;
  /** SARIF artifact path when the check emits SARIF on stdout. */
  sarifOutput?: string;
  /** Where the check came from. */
  source: "planner" | "script";
}

/** package.json script names that map to pipeline steps. */
const DETECT_SCRIPT_CHECKS = [
  "lint",
  "typecheck",
  "test",
  "build",
  "format",
  "check",
] as const;

/**
 * Read package.json scripts under root. Returns an empty map when absent or
 * malformed. Ground truth for JS/TS projects.
 */
function readPackageScripts(root: string): Record<string, string> {
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ) as {
      scripts?: Record<string, unknown>;
    };
    const scripts = pkg.scripts ?? {};
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(scripts)) {
      if (typeof value === "string" && value.length > 0) out[name] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * True when a command is a package-manager script invocation
 * (`<pm> run <script>`) whose script does not exist — a phantom step that
 * would fail with "Missing script" on first run.
 */
function isPhantomScriptStep(
  command: string,
  scripts: Record<string, string>,
): boolean {
  const m = /^(?:bun|npm|pnpm|yarn|deno)\s+run\s+([A-Za-z0-9:_-]+)/.exec(
    command.trim(),
  );
  if (m === null) return false;
  return !(m[1]! in scripts);
}

/**
 * Detect checks for the project at `root`: planner proposals (filtered to
 * real scripts) plus any known check scripts the planner did not cover.
 */
export async function detectProjectChecks(
  root: string,
): Promise<DetectedCheck[]> {
  const pm = detectPackageManager(root);
  const scripts = readPackageScripts(root);
  const checks: DetectedCheck[] = [];

  // Planner-based detection covers non-npm ecosystems (cargo, go, ruff).
  // It requires a git repository — degrade gracefully when unavailable.
  try {
    const planner = createPlanner();
    // Scope detection to `root`: generated ShellSteps run with cwd=root,
    // so proposals driven by manifests outside the subtree would fail.
    const ctx = await planner.discover({ root, scopeToRoot: true });
    const proposal = await planner.plan(ctx);
    if (proposal.checks.length > 0) {
      const resolver = createBuiltinResolver();
      const resolved = synthesizeCheckSteps(proposal.checks, ctx, resolver);
      for (const r of resolved) {
        const shellOp = r.step.operations.find((o) => o.kind === "shell");
        const command = shellOp?.kind === "shell" ? shellOp.command : "";
        // Planner proposes checks by ecosystem, not by package.json
        // scripts — drop `<pm> run <script>` steps for missing scripts.
        if (isPhantomScriptStep(command, scripts)) continue;
        const sarifOut = r.outputs.find((o) => o.format === "sarif");
        checks.push({
          checkId: r.checkId,
          command,
          ...(sarifOut !== undefined ? { sarifOutput: sarifOut.path } : {}),
          source: "planner",
        });
      }
    }
  } catch {
    // discovery unavailable (e.g. not a git repo) — script checks still apply
  }

  // Emit a check for every known script present in package.json that
  // detection did not already cover.
  for (const name of DETECT_SCRIPT_CHECKS) {
    if (!(name in scripts)) continue;
    if (checks.some((c) => c.checkId === name)) continue;
    checks.push({
      checkId: name,
      command: `${pm} run ${name}`,
      source: "script",
    });
  }

  return checks;
}
