import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OperationSpec } from "@sverka/core";
import type {
  ProposedCheck,
  ProjectContext,
  DetectedPackageManager,
} from "@sverka/planner";

/**
 * Resolves a ProposedCheck into an executable OperationSpec with output
 * declarations. Returns null when the resolver has no mapping for the
 * given check + context (the caller skips the check).
 */
export interface CheckResolver {
  resolve(check: ProposedCheck, ctx: ProjectContext): ResolvedCheck | null;
}

/**
 * A fully-resolved check: an OperationSpec for the IR plus output
 * declarations for findings extraction.
 */
export interface ResolvedCheck {
  readonly checkId: string;
  readonly operation: OperationSpec;
  readonly outputs: readonly CheckOutput[];
}

/**
 * An output file a check produces, used for findings extraction.
 */
export interface CheckOutput {
  /** Relative path within the artifact directory. */
  readonly path: string;
  readonly format: "sarif" | "json" | "junit" | "text";
}

type PmName = DetectedPackageManager["name"];

interface TableEntry {
  readonly checkId: string;
  /** Proposal reason this entry matches (e.g. "Node project defaults"). */
  readonly reason: string;
  readonly packageManagers: readonly PmName[];
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * Built-in resolution table. Order matters: the first matching entry
 * (by checkId + packageManager) wins. Node entries come before Python,
 * Rust, and Go so that Node checks take precedence when multiple
 * package managers are present.
 */
const NODE_REASON = "Node project defaults";
const PYTHON_REASON = "Python project defaults";
const RUST_REASON = "Rust project defaults";
const GO_REASON = "Go project defaults";
const KNOWN_REASONS = new Set([NODE_REASON, PYTHON_REASON, RUST_REASON, GO_REASON]);

const TABLE: readonly TableEntry[] = [
  // Node — typecheck
  { checkId: "typecheck", reason: NODE_REASON, packageManagers: ["bun"], command: "bun", args: ["run", "typecheck"] },
  { checkId: "typecheck", reason: NODE_REASON, packageManagers: ["npm"], command: "npm", args: ["run", "typecheck"] },
  { checkId: "typecheck", reason: NODE_REASON, packageManagers: ["yarn"], command: "yarn", args: ["run", "typecheck"] },
  { checkId: "typecheck", reason: NODE_REASON, packageManagers: ["pnpm"], command: "pnpm", args: ["run", "typecheck"] },
  // Node — lint
  { checkId: "lint", reason: NODE_REASON, packageManagers: ["bun"], command: "bun", args: ["run", "lint"] },
  { checkId: "lint", reason: NODE_REASON, packageManagers: ["npm"], command: "npm", args: ["run", "lint"] },
  { checkId: "lint", reason: NODE_REASON, packageManagers: ["yarn"], command: "yarn", args: ["run", "lint"] },
  { checkId: "lint", reason: NODE_REASON, packageManagers: ["pnpm"], command: "pnpm", args: ["run", "lint"] },
  // Node — test
  { checkId: "test", reason: NODE_REASON, packageManagers: ["bun"], command: "bun", args: ["run", "test"] },
  { checkId: "test", reason: NODE_REASON, packageManagers: ["npm"], command: "npm", args: ["run", "test"] },
  { checkId: "test", reason: NODE_REASON, packageManagers: ["yarn"], command: "yarn", args: ["run", "test"] },
  { checkId: "test", reason: NODE_REASON, packageManagers: ["pnpm"], command: "pnpm", args: ["run", "test"] },
  // Python — lint
  { checkId: "lint", reason: PYTHON_REASON, packageManagers: ["pip", "poetry", "uv", "pipenv"], command: "ruff", args: ["check"] },
  // Python — test
  { checkId: "test", reason: PYTHON_REASON, packageManagers: ["pip", "poetry", "uv", "pipenv"], command: "pytest", args: [] },
  // Rust
  { checkId: "clippy", reason: RUST_REASON, packageManagers: ["cargo"], command: "cargo", args: ["clippy"] },
  { checkId: "fmt-check", reason: RUST_REASON, packageManagers: ["cargo"], command: "cargo", args: ["fmt", "--check"] },
  { checkId: "test", reason: RUST_REASON, packageManagers: ["cargo"], command: "cargo", args: ["test"] },
  // Go
  { checkId: "vet", reason: GO_REASON, packageManagers: ["go"], command: "go", args: ["vet", "./..."] },
  { checkId: "test", reason: GO_REASON, packageManagers: ["go"], command: "go", args: ["test", "./..."] },
];

/**
 * Built-in resolver backed by a (checkId, packageManager) → command table.
 * Covers the 6 checkIds the planner proposes across Node/Python/Rust/Go.
 * Never throws — returns null for unknown mappings.
 *
 * Table order determines precedence: Node entries come before Python/Rust/Go,
 * so when multiple package managers are present the first matching entry wins.
 */
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
    // When the planner supplies a known ecosystem reason, require an exact match
    // so polyglot projects resolve to the correct tool instead of table order.
    if (KNOWN_REASONS.has(check.reason) && entry.reason !== check.reason) continue;
    if (!entry.packageManagers.some((pm) => pmNames.includes(pm))) continue;
    if (!isEntryApplicable(entry, ctx.root, rootPkg)) continue;
    const operation: OperationSpec = {
      id: check.id,
      kind: "check",
      name: check.checkId,
      description: check.reason,
      command: entry.command,
      args: entry.args,
    };
    return { checkId: check.checkId, operation, outputs: [] };
  }
  return null;
}

/** Validate Node entries against the root package.json (packageManager field and scripts). */
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
