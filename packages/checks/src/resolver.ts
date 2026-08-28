// Check resolver — resolves ProposedCheck into StepDefinition.
// Spec 14 — §24, §25. Reuses the existing resolution table but produces
// StepDefinition (new graph model) instead of the old OperationSpec.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StepDefinition, OperationSpec } from "@sverka/core";
import type {
  ProposedCheck,
  ProjectContext,
  DetectedPackageManager,
} from "@sverka/planner";

/**
 * Resolves a ProposedCheck into a ResolvedCheck containing a StepDefinition.
 * Returns null when the resolver has no mapping for the given check + context.
 */
export interface CheckResolver {
  resolve(check: ProposedCheck, ctx: ProjectContext): ResolvedCheck | null;
}

/**
 * A fully-resolved check: a StepDefinition for the Definition Graph plus
 * output declarations for findings extraction.
 */
export interface ResolvedCheck {
  readonly checkId: string;
  readonly step: StepDefinition;
  readonly operation: OperationSpec;
  readonly outputs: readonly CheckOutput[];
}

/**
 * An output file a check produces, used for findings extraction.
 */
export interface CheckOutput {
  readonly path: string;
  readonly format: "sarif" | "json" | "junit" | "text";
}

type PmName = DetectedPackageManager["name"];

interface TableEntry {
  readonly checkId: string;
  readonly reason: string;
  readonly packageManagers: readonly PmName[];
  readonly command: string;
  readonly args: readonly string[];
}

const NODE_REASON = "Node project defaults";
const PYTHON_REASON = "Python project defaults";
const RUST_REASON = "Rust project defaults";
const GO_REASON = "Go project defaults";
const KNOWN_REASONS = new Set([NODE_REASON, PYTHON_REASON, RUST_REASON, GO_REASON]);

const SAFE_SHELL_ARG = /^[\w.\/:@=-]+$/;

function quoteShellArg(arg: string): string {
  if (SAFE_SHELL_ARG.test(arg)) return arg;
  return `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

const TABLE: readonly TableEntry[] = [
  { checkId: "typecheck", reason: NODE_REASON, packageManagers: ["bun"], command: "bun", args: ["run", "typecheck"] },
  { checkId: "typecheck", reason: NODE_REASON, packageManagers: ["npm"], command: "npm", args: ["run", "typecheck"] },
  { checkId: "typecheck", reason: NODE_REASON, packageManagers: ["yarn"], command: "yarn", args: ["run", "typecheck"] },
  { checkId: "typecheck", reason: NODE_REASON, packageManagers: ["pnpm"], command: "pnpm", args: ["run", "typecheck"] },
  { checkId: "lint", reason: NODE_REASON, packageManagers: ["bun"], command: "bun", args: ["run", "lint"] },
  { checkId: "lint", reason: NODE_REASON, packageManagers: ["npm"], command: "npm", args: ["run", "lint"] },
  { checkId: "lint", reason: NODE_REASON, packageManagers: ["yarn"], command: "yarn", args: ["run", "lint"] },
  { checkId: "lint", reason: NODE_REASON, packageManagers: ["pnpm"], command: "pnpm", args: ["run", "lint"] },
  { checkId: "test", reason: NODE_REASON, packageManagers: ["bun"], command: "bun", args: ["run", "test"] },
  { checkId: "test", reason: NODE_REASON, packageManagers: ["npm"], command: "npm", args: ["run", "test"] },
  { checkId: "test", reason: NODE_REASON, packageManagers: ["yarn"], command: "yarn", args: ["run", "test"] },
  { checkId: "test", reason: NODE_REASON, packageManagers: ["pnpm"], command: "pnpm", args: ["run", "test"] },
  { checkId: "lint", reason: PYTHON_REASON, packageManagers: ["pip", "poetry", "uv", "pipenv"], command: "ruff", args: ["check"] },
  { checkId: "test", reason: PYTHON_REASON, packageManagers: ["pip", "poetry", "uv", "pipenv"], command: "pytest", args: [] },
  { checkId: "clippy", reason: RUST_REASON, packageManagers: ["cargo"], command: "cargo", args: ["clippy"] },
  { checkId: "fmt-check", reason: RUST_REASON, packageManagers: ["cargo"], command: "cargo", args: ["fmt", "--check"] },
  { checkId: "test", reason: RUST_REASON, packageManagers: ["cargo"], command: "cargo", args: ["test"] },
  { checkId: "vet", reason: GO_REASON, packageManagers: ["go"], command: "go", args: ["vet", "./..."] },
  { checkId: "test", reason: GO_REASON, packageManagers: ["go"], command: "go", args: ["test", "./..."] },
];

/** Create the built-in check resolver backed by the resolution table. */
export function createBuiltinResolver(): CheckResolver {
  return {
    resolve(check, ctx) {
      const pmNames = ctx.packageManagers.map((p) => p.name);
      const rootPkg = readRootPackageJson(ctx.root);
      return findEntry(check, ctx, pmNames, rootPkg);
    },
  };
}

function findEntry(
  check: ProposedCheck,
  ctx: ProjectContext,
  pmNames: PmName[],
  rootPkg: Record<string, unknown> | null,
): ResolvedCheck | null {
  for (const entry of TABLE) {
    if (entry.checkId !== check.checkId) continue;
    if (KNOWN_REASONS.has(check.reason) && entry.reason !== check.reason) continue;
    if (!entry.packageManagers.some((pm) => pmNames.includes(pm))) continue;
    if (!isEntryApplicable(entry, ctx.root, rootPkg)) continue;

    const command = [entry.command, ...entry.args.map(quoteShellArg)].join(" ");
    const step: StepDefinition = {
      id: `checks/${check.checkId}`,
      runtime: { mode: "host", workingDir: ctx.root },
      operations: [{ kind: "shell", command }],
      inputs: [],
      outputs: [],
      dependencies: [],
    };
    const operation: OperationSpec = {
      id: `checks/${check.checkId}`,
      kind: "run",
      name: check.checkId,
      command,
    };
    return { checkId: check.checkId, step, operation, outputs: [] };
  }
  return null;
}

function isEntryApplicable(
  entry: TableEntry,
  root: string,
  rootPkg: Record<string, unknown> | null,
): boolean {
  if (entry.reason !== NODE_REASON) return true;
  if (!rootPkg) return true;

  const packageManager = rootPkg["packageManager"];
  if (typeof packageManager === "string") {
    const tool = packageManager.split("@")[0];
    if (tool && tool !== entry.command) return false;
  }

  const scripts = rootPkg["scripts"];
  if (isPlainObject(scripts)) {
    const scriptName = entry.args[1];
    if (typeof scriptName === "string" && !(scriptName in scripts)) return false;
  }

  return true;
}

function readRootPackageJson(root: string): Record<string, unknown> | null {
  const path = resolve(root, "package.json");
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
