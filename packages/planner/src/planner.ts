import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createGitCli, type GitCli } from "./internal/git-cli.js";
import {
  detectSignals,
  detectLanguages,
  detectPackageManagers,
  detectMonorepo,
} from "./detect.js";
import { buildExplanation } from "./explain.js";
import { DiscoveryError } from "./errors.js";

/**
 * Top-level entry point for discovery and plan synthesis.
 */
export interface Planner {
  discover(options: DiscoverOptions): Promise<ProjectContext>;
  plan(context: ProjectContext): Promise<PlanProposal>;
}

export function createPlanner(): Planner {
  return new PlannerImpl();
}

export interface DiscoverOptions {
  root: string;
  baseRef?: string;
  maxDepth?: number;
}

export interface ProjectContext {
  root: string;
  commit: string;
  dirty: boolean;
  changedFiles: readonly ChangedFile[];
  languages: readonly DetectedLanguage[];
  packageManagers: readonly DetectedPackageManager[];
  hasContainerBuild: boolean;
  hasCiDefinition: boolean;
  monorepo: MonorepoMarker | null;
  localSignals: readonly LocalSignal[];
  explanation: DiscoveryExplanation;
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
}

export interface DetectedLanguage {
  name: string;
  confidence: number;
  evidence: string[];
  fileCount: number;
}

export type PackageManagerName =
  | "npm"
  | "yarn"
  | "pnpm"
  | "bun"
  | "pip"
  | "poetry"
  | "uv"
  | "pipenv"
  | "cargo"
  | "go"
  | "maven"
  | "gradle"
  | "composer"
  | "other";

export interface DetectedPackageManager {
  name: PackageManagerName;
  version: string | null;
  lockfile: string | null;
  evidence: string[];
}

export type MonorepoTool =
  | "nx"
  | "turborepo"
  | "lerna"
  | "pnpm-workspace"
  | "bun-workspace"
  | "custom";

export interface MonorepoMarker {
  tool: MonorepoTool;
  workspaces: readonly string[];
  evidence: string[];
}

export type LocalSignalType =
  | "manifest"
  | "lockfile"
  | "dockerfile"
  | "docker-compose"
  | "ci-definition"
  | "monorepo-marker"
  | "git-metadata";

export interface LocalSignal {
  type: LocalSignalType;
  path: string;
  detail: string | null;
  confidence: number;
}

export interface PlanProposal {
  context: ProjectContext;
  checks: readonly ProposedCheck[];
  workflowPath: string | null;
  notes: readonly string[];
}

export interface ProposedCheck {
  id: string;
  checkId: string;
  reason: string;
  signalRef: string | null;
  priority: number;
}

export interface DiscoveryExplanation {
  summary: string;
  signalCounts: Readonly<Record<LocalSignalType, number>>;
}

const DEFAULT_MAX_DEPTH = 10;

class PlannerImpl implements Planner {
  private readonly git: GitCli;

  constructor() {
    this.git = createGitCli();
  }

  async discover(options: DiscoverOptions): Promise<ProjectContext> {
    const root = options.root;
    if (!existsSync(root)) {
      throw new DiscoveryError(
        `root directory not found: ${root}`,
        "ROOT_NOT_FOUND",
      );
    }
    try {
      await this.git.run(["--version"], root);
    } catch (err) {
      throw new DiscoveryError(
        "git is not installed or not on PATH",
        "GIT_UNAVAILABLE",
        err,
      );
    }
    let toplevel: string;
    try {
      const out = await this.git.run(["rev-parse", "--show-toplevel"], root);
      toplevel = out.trim();
    } catch (err) {
      throw new DiscoveryError(
        `not a git repository: ${root}`,
        "GIT_NOT_A_REPO",
        err,
      );
    }
    let trackedRaw: string;
    let porcelainRaw: string;
    try {
      trackedRaw = await this.git.run(["ls-files"], toplevel);
      porcelainRaw = await this.git.run(["status", "--porcelain"], toplevel);
    } catch (err) {
      throw new DiscoveryError(
        "filesystem traversal failed",
        "TRAVERSAL_FAILED",
        err,
      );
    }
    const tracked = trackedRaw.split("\n").filter(Boolean);
    const porcelain = porcelainRaw.split("\n").filter(Boolean);
    const untracked: string[] = [];
    for (const line of porcelain) {
      const status = line.slice(0, 2);
      const path = line.slice(3).trim();
      if (status.includes("??")) {
        untracked.push(path);
      }
    }
    const allFiles = [...new Set([...tracked, ...untracked])];
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    const filtered = applyMaxDepth(allFiles, maxDepth);

    const signals = detectSignals(filtered);
    const languages = detectLanguages(filtered);
    const rootPkgJson = readRootPackageJson(toplevel);
    const packageManagers = detectPackageManagers(signals, rootPkgJson);
    const monorepo = detectMonorepo(signals, rootPkgJson);
    const hasContainerBuild = signals.some(
      (s) => s.type === "dockerfile" || s.type === "docker-compose",
    );
    const hasCiDefinition = signals.some((s) => s.type === "ci-definition");

    let commit = "";
    try {
      const out = await this.git.run(["rev-parse", "HEAD"], toplevel);
      commit = out.trim();
    } catch {
      commit = "";
    }
    const dirty = porcelain.length > 0;

    let changedFiles: ChangedFile[] = [];
    if (options.baseRef) {
      try {
        const diff = await this.git.run(
          ["diff", "--name-status", `${options.baseRef}..HEAD`],
          toplevel,
        );
        changedFiles = parseDiffNameStatus(diff);
      } catch (err) {
        throw new DiscoveryError(
          `failed to diff against baseRef "${options.baseRef}"`,
          "TRAVERSAL_FAILED",
          err,
        );
      }
    }

    const gitSignal: LocalSignal = {
      type: "git-metadata",
      path: ".git",
      detail: commit ? `HEAD=${commit.slice(0, 12)}` : "no commits",
      confidence: 1.0,
    };
    const allSignals = [...signals, gitSignal];

    const explanation = buildExplanation(allSignals, {
      hasBaseRef: Boolean(options.baseRef),
      dirty,
    });

    return {
      root: toplevel,
      commit,
      dirty,
      changedFiles,
      languages,
      packageManagers,
      hasContainerBuild,
      hasCiDefinition,
      monorepo,
      localSignals: allSignals,
      explanation,
    };
  }

  async plan(context: ProjectContext): Promise<PlanProposal> {
    return synthesizePlan(context);
  }
}

function applyMaxDepth(files: string[], maxDepth: number): string[] {
  return files.filter((f) => f.split("/").length <= maxDepth);
}

function readRootPackageJson(root: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(`${root}/package.json`, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseDiffNameStatus(diff: string): ChangedFile[] {
  const out: ChangedFile[] = [];
  for (const line of diff.split("\n").filter(Boolean)) {
    const parts = line.split("\t");
    const code = parts[0] ?? "";
    const path = parts[1] ?? "";
    if (!path) continue;
    let status: ChangedFile["status"];
    if (code.startsWith("A")) status = "added";
    else if (code.startsWith("M")) status = "modified";
    else if (code.startsWith("D")) status = "deleted";
    else if (code.startsWith("R")) status = "renamed";
    else status = "modified";
    out.push({ path, status });
  }
  return out;
}

interface PlanDriver {
  checkId: string;
  reason: string;
  languages: string[];
  packageManagers: PackageManagerName[];
}

const PLAN_DRIVERS: readonly PlanDriver[] = [
  {
    checkId: "typecheck",
    reason: "Node project defaults",
    languages: ["TypeScript", "JavaScript"],
    packageManagers: ["npm", "yarn", "pnpm", "bun"],
  },
  {
    checkId: "lint",
    reason: "Node project defaults",
    languages: ["TypeScript", "JavaScript"],
    packageManagers: ["npm", "yarn", "pnpm", "bun"],
  },
  {
    checkId: "test",
    reason: "Node project defaults",
    languages: ["TypeScript", "JavaScript"],
    packageManagers: ["npm", "yarn", "pnpm", "bun"],
  },
  {
    checkId: "lint",
    reason: "Python project defaults",
    languages: ["Python"],
    packageManagers: ["pip", "poetry", "uv", "pipenv"],
  },
  {
    checkId: "test",
    reason: "Python project defaults",
    languages: ["Python"],
    packageManagers: ["pip", "poetry", "uv", "pipenv"],
  },
  {
    checkId: "fmt-check",
    reason: "Rust project defaults",
    languages: ["Rust"],
    packageManagers: ["cargo"],
  },
  {
    checkId: "clippy",
    reason: "Rust project defaults",
    languages: ["Rust"],
    packageManagers: ["cargo"],
  },
  {
    checkId: "test",
    reason: "Rust project defaults",
    languages: ["Rust"],
    packageManagers: ["cargo"],
  },
  {
    checkId: "vet",
    reason: "Go project defaults",
    languages: ["Go"],
    packageManagers: ["go"],
  },
  {
    checkId: "test",
    reason: "Go project defaults",
    languages: ["Go"],
    packageManagers: ["go"],
  },
];

function synthesizePlan(context: ProjectContext): PlanProposal {
  const langNames = context.languages.map((l) => l.name);
  const pmNames = context.packageManagers.map((p) => p.name);
  const notes: string[] = [];
  const checks: ProposedCheck[] = [];
  const seen = new Set<string>();

  const manifestSignal =
    context.localSignals.find(
      (s) => s.type === "manifest" || s.type === "lockfile",
    ) ?? null;
  const signalRef = manifestSignal
    ? `${manifestSignal.type}:${manifestSignal.path}`
    : null;

  for (const driver of PLAN_DRIVERS) {
    const langMatch = driver.languages.some((l) => langNames.includes(l));
    const pmMatch = driver.packageManagers.some((p) => pmNames.includes(p));
    if (!langMatch || !pmMatch) continue;
    const key = `${driver.checkId}:${driver.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = `prop-${createHash("sha256").update(`${driver.checkId}${driver.reason}`).digest("hex").slice(0, 16)}`;
    checks.push({
      id,
      checkId: driver.checkId,
      reason: driver.reason,
      signalRef,
      priority: 2,
    });
  }

  if (checks.length === 0) {
    notes.push(
      "No default checks applied: no recognized languages or package managers detected.",
    );
  } else {
    const drivers: string[] = [];
    if (langNames.length) drivers.push(`languages=[${langNames.join(",")}]`);
    if (pmNames.length) drivers.push(`packageManagers=[${pmNames.join(",")}]`);
    notes.push(
      `Selected ${checks.length} default checks from ${drivers.join(" ")}.`,
    );
  }

  return { context, checks, workflowPath: null, notes };
}
