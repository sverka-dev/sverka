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
const TABLE: readonly TableEntry[] = [
  // Node — typecheck
  { checkId: "typecheck", packageManagers: ["bun"], command: "bun", args: ["run", "typecheck"] },
  { checkId: "typecheck", packageManagers: ["npm"], command: "npm", args: ["run", "typecheck"] },
  { checkId: "typecheck", packageManagers: ["yarn"], command: "yarn", args: ["run", "typecheck"] },
  { checkId: "typecheck", packageManagers: ["pnpm"], command: "pnpm", args: ["run", "typecheck"] },
  // Node — lint
  { checkId: "lint", packageManagers: ["bun"], command: "bun", args: ["run", "lint"] },
  { checkId: "lint", packageManagers: ["npm"], command: "npm", args: ["run", "lint"] },
  { checkId: "lint", packageManagers: ["yarn"], command: "yarn", args: ["run", "lint"] },
  { checkId: "lint", packageManagers: ["pnpm"], command: "pnpm", args: ["run", "lint"] },
  // Node — test
  { checkId: "test", packageManagers: ["bun"], command: "bun", args: ["run", "test"] },
  { checkId: "test", packageManagers: ["npm"], command: "npm", args: ["run", "test"] },
  { checkId: "test", packageManagers: ["yarn"], command: "yarn", args: ["run", "test"] },
  { checkId: "test", packageManagers: ["pnpm"], command: "pnpm", args: ["run", "test"] },
  // Python — lint
  { checkId: "lint", packageManagers: ["pip", "poetry", "uv", "pipenv"], command: "ruff", args: ["check"] },
  // Python — test
  { checkId: "test", packageManagers: ["pip", "poetry", "uv", "pipenv"], command: "pytest", args: [] },
  // Rust
  { checkId: "clippy", packageManagers: ["cargo"], command: "cargo", args: ["clippy"] },
  { checkId: "fmt-check", packageManagers: ["cargo"], command: "cargo", args: ["fmt", "--check"] },
  { checkId: "test", packageManagers: ["cargo"], command: "cargo", args: ["test"] },
  // Go
  { checkId: "vet", packageManagers: ["go"], command: "go", args: ["vet", "./..."] },
  { checkId: "test", packageManagers: ["go"], command: "go", args: ["test", "./..."] },
];

/**
 * Built-in resolver backed by a (checkId, packageManager) → command table.
 * Covers the 6 checkIds the planner proposes across Node/Python/Rust/Go.
 * Never throws — returns null for unknown mappings.
 */
export function createBuiltinResolver(): CheckResolver {
  return {
    resolve(check, ctx) {
      const pmNames = ctx.packageManagers.map((p) => p.name);
      for (const entry of TABLE) {
        if (entry.checkId !== check.checkId) continue;
        if (!entry.packageManagers.some((pm) => pmNames.includes(pm))) continue;
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
    },
  };
}
