import type { ProjectContext, ChangedFile, DetectedLanguage, PackageManagerName, DetectedPackageManager, MonorepoTool, MonorepoMarker, LocalSignalType, LocalSignal, ProposedCheck, DiscoveryExplanation } from "@sverka/workflow";
export type { ProjectContext, ChangedFile, DetectedLanguage, PackageManagerName, DetectedPackageManager, MonorepoTool, MonorepoMarker, LocalSignalType, LocalSignal, ProposedCheck, DiscoveryExplanation };
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
import { bindRunPlan as bindRunPlanImpl, type BindRunPlanOptions } from "./bind.js";
import type { RunPlan } from "@sverka/workflow";

/**
 * Top-level entry point for discovery and plan synthesis.
 */
export interface Planner {
  discover(options: DiscoverOptions): Promise<ProjectContext>;
  plan(context: ProjectContext): Promise<PlanProposal>;
  bindRunPlan(options: BindRunPlanOptions): RunPlan;
}

export function createPlanner(): Planner {
  return new PlannerImpl();
}

export interface DiscoverOptions {
  root: string;
  baseRef?: string;
  maxDepth?: number;
}

export interface PlanProposal {
  context: ProjectContext;
  checks: readonly ProposedCheck[];
  workflowPath: string | null;
  notes: readonly string[];
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
      throw new DiscoveryError(`root directory not found: ${root}`, "ROOT_NOT_FOUND");
    }
    await assertGitAvailable(this.git, root);
    const toplevel = await resolveToplevel(this.git, root);
    const { tracked, untracked, porcelain } = await collectGitFiles(this.git, toplevel);
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

    const commit = await resolveHeadCommit(this.git, toplevel);
    const dirty = porcelain.length > 0;
    const changedFiles = await collectChangedFiles(this.git, toplevel, options.baseRef);

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

  bindRunPlan(options: BindRunPlanOptions): RunPlan {
    return bindRunPlanImpl(options);
  }
}

function applyMaxDepth(files: string[], maxDepth: number): string[] {
  return files.filter((f) => f.split("/").length <= maxDepth);
}

/** Throw `GIT_UNAVAILABLE` if git is not on PATH. */
async function assertGitAvailable(git: GitCli, root: string): Promise<void> {
  try {
    await git.run(["--version"], root);
  } catch (err) {
    throw new DiscoveryError("git is not installed or not on PATH", "GIT_UNAVAILABLE", err);
  }
}

/** Resolve the repository toplevel, throwing `GIT_NOT_A_REPO` on failure. */
async function resolveToplevel(git: GitCli, root: string): Promise<string> {
  try {
    const out = await git.run(["rev-parse", "--show-toplevel"], root);
    return out.trim();
  } catch (err) {
    throw new DiscoveryError(`not a git repository: ${root}`, "GIT_NOT_A_REPO", err);
  }
}

/** Collect tracked files, untracked files, and porcelain lines from git. */
async function collectGitFiles(
  git: GitCli,
  toplevel: string,
): Promise<{ tracked: string[]; untracked: string[]; porcelain: string[] }> {
  let trackedRaw: string;
  let porcelainRaw: string;
  try {
    trackedRaw = await git.run(["ls-files"], toplevel);
    porcelainRaw = await git.run(["status", "--porcelain", "-uall"], toplevel);
  } catch (err) {
    throw new DiscoveryError("filesystem traversal failed", "TRAVERSAL_FAILED", err);
  }
  const tracked = trackedRaw.split("\n").filter(Boolean);
  const porcelain = porcelainRaw.split("\n").filter(Boolean);
  const untracked = extractUntracked(porcelain);
  return { tracked, untracked, porcelain };
}

/** Extract untracked file paths from porcelain status lines. */
function extractUntracked(porcelain: readonly string[]): string[] {
  const untracked: string[] = [];
  for (const line of porcelain) {
    const status = line.slice(0, 2);
    const path = line.slice(3).trim();
    if (status.includes("??")) {
      untracked.push(path);
    }
  }
  return untracked;
}

/** Resolve the HEAD commit SHA, returning "" on failure. */
async function resolveHeadCommit(git: GitCli, toplevel: string): Promise<string> {
  try {
    const out = await git.run(["rev-parse", "HEAD"], toplevel);
    return out.trim();
  } catch {
    return "";
  }
}

const REF_RE = /^[A-Za-z0-9_./~^\-@{}]+$/;

function validateBaseRef(baseRef: string): void {
  if (baseRef.startsWith("-") || !REF_RE.test(baseRef)) {
    throw new DiscoveryError(
      `invalid baseRef: ${baseRef}`,
      "INVALID_BASE_REF",
    );
  }
}

/** Collect changed files against `baseRef` when provided. */
async function collectChangedFiles(
  git: GitCli,
  toplevel: string,
  baseRef: string | undefined,
): Promise<ChangedFile[]> {
  if (!baseRef) return [];
  validateBaseRef(baseRef);
  try {
    const diff = await git.run(
      ["diff", "--name-status", `${baseRef}...HEAD`, "--"],
      toplevel,
    );
    return parseDiffNameStatus(diff);
  } catch (err) {
    throw new DiscoveryError(
      `failed to diff against baseRef "${baseRef}"`,
      "TRAVERSAL_FAILED",
      err,
    );
  }
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
    // Rename records have the format "R<score>\told\tnew"; use the new path.
    const path = code.startsWith("R") ? (parts[2] ?? "") : (parts[1] ?? "");
    if (!path) continue;
    out.push({ path, status: diffStatusCode(code) });
  }
  return out;
}

/** Map a git diff --name-status code to a `ChangedFile` status. */
function diffStatusCode(code: string): ChangedFile["status"] {
  if (code.startsWith("A")) return "added";
  if (code.startsWith("M")) return "modified";
  if (code.startsWith("D")) return "deleted";
  if (code.startsWith("R")) return "renamed";
  return "modified";
}

interface PlanDriver {
  checkId: string;
  reason: string;
  languages: string[];
  packageManagers: PackageManagerName[];
}

const PLAN_DRIVERS: readonly PlanDriver[] = [
  { checkId: "typecheck", reason: "Node project defaults", languages: ["TypeScript", "JavaScript"], packageManagers: ["npm", "yarn", "pnpm", "bun"] },
  { checkId: "lint", reason: "Node project defaults", languages: ["TypeScript", "JavaScript"], packageManagers: ["npm", "yarn", "pnpm", "bun"] },
  { checkId: "test", reason: "Node project defaults", languages: ["TypeScript", "JavaScript"], packageManagers: ["npm", "yarn", "pnpm", "bun"] },
  { checkId: "lint", reason: "Python project defaults", languages: ["Python"], packageManagers: ["pip", "poetry", "uv", "pipenv"] },
  { checkId: "test", reason: "Python project defaults", languages: ["Python"], packageManagers: ["pip", "poetry", "uv", "pipenv"] },
  { checkId: "fmt-check", reason: "Rust project defaults", languages: ["Rust"], packageManagers: ["cargo"] },
  { checkId: "clippy", reason: "Rust project defaults", languages: ["Rust"], packageManagers: ["cargo"] },
  { checkId: "test", reason: "Rust project defaults", languages: ["Rust"], packageManagers: ["cargo"] },
  { checkId: "vet", reason: "Go project defaults", languages: ["Go"], packageManagers: ["go"] },
  { checkId: "test", reason: "Go project defaults", languages: ["Go"], packageManagers: ["go"] },
];

function synthesizePlan(context: ProjectContext): PlanProposal {
  const langNames = context.languages.map((l) => l.name);
  const pmNames = context.packageManagers.map((p) => p.name);
  const signalRef = resolveSignalRef(context.localSignals);
  const checks = collectDefaultChecks(PLAN_DRIVERS, langNames, pmNames, signalRef);
  const notes = buildPlanNotes(checks, langNames, pmNames);
  return { context, checks, workflowPath: null, notes };
}

/** Resolve the signal reference for the first manifest/lockfile signal. */
function resolveSignalRef(signals: readonly LocalSignal[]): string | null {
  const manifestSignal = signals.find(
    (s) => s.type === "manifest" || s.type === "lockfile",
  ) ?? null;
  return manifestSignal ? `${manifestSignal.type}:${manifestSignal.path}` : null;
}

/** Collect deduplicated default checks that match the detected languages/package managers. */
function collectDefaultChecks(
  drivers: readonly PlanDriver[],
  langNames: readonly string[],
  pmNames: readonly PackageManagerName[],
  signalRef: string | null,
): ProposedCheck[] {
  const checks: ProposedCheck[] = [];
  const seen = new Set<string>();
  for (const driver of drivers) {
    const langMatch = driver.languages.some((l) => langNames.includes(l));
    const pmMatch = driver.packageManagers.some((p) => pmNames.includes(p));
    if (!langMatch || !pmMatch) continue;
    const key = `${driver.checkId}:${driver.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const id = makeCheckId(driver.checkId, driver.reason);
    checks.push({ id, checkId: driver.checkId, reason: driver.reason, signalRef, priority: 2 });
  }
  return checks;
}

/** Build a stable proposed-check id from its checkId and reason. */
function makeCheckId(checkId: string, reason: string): string {
  const digest = createHash("sha256").update(checkId + reason).digest("hex").slice(0, 16);
  return "prop-" + digest;
}

/** Build human-readable notes describing the selected checks. */
function buildPlanNotes(
  checks: readonly ProposedCheck[],
  langNames: readonly string[],
  pmNames: readonly PackageManagerName[],
): string[] {
  if (checks.length === 0) {
    return ["No default checks applied: no recognized languages or package managers detected."];
  }
  const drivers: string[] = [];
  if (langNames.length) drivers.push(`languages=[${langNames.join(",")}]`);
  if (pmNames.length) drivers.push(`packageManagers=[${pmNames.join(",")}]`);
  return [`Selected ${checks.length} default checks from ${drivers.join(" ")}.`];
}
