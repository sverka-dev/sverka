# Spec 06 — Planner Package: Discovery and Plan Synthesis

## Overview

The `planner` package discovers project context from the local working tree
and synthesizes a verification plan proposal. It inspects manifests,
lockfiles, dockerfiles, CI definitions, monorepo markers, and git metadata,
assembles a `ProjectContext`, and proposes default checks for projects with
no user-supplied workflow. Discovery is deterministic and side-effect free:
it does not mutate the working tree, write files, or make network calls.

The planner does not execute checks and does not query remote providers. It
only gathers local signals and produces a plan proposal. Execution is the
runtime's job; remote discovery is a later wave (`runtime-remote`).

## Goals

1. Discover project context from local filesystem signals with zero
   configuration.
2. Produce a `ProjectContext` model describing the project under analysis.
3. Record every discovery signal with its source and confidence so the plan
   is explainable.
4. Synthesize a default plan proposal from discovered context when no
   user-supplied workflow exists.
5. Detect package managers, languages, dockerfiles, CI definitions, and
   monorepo layouts to inform default check selection.
6. Remain deterministic: identical inputs produce identical `ProjectContext`.
7. Remain side-effect free: discovery reads the filesystem and git only; it
   never mutates, writes, or calls the network.

## Non-goals (v1 / Wave 6)

- Executing checks or running tools during discovery.
- Mutating project files or configuration.
- Remote discovery of any kind: GitHub, GitLab, SonarCloud, Dependabot, code
  scanning, cloud providers. Deferred to a later wave (`runtime-remote`).
- Cloud credential detection (AWS/GCP/Azure). Deferred.
- Framework detection (no consumer needs it yet). Deferred.
- Infrastructure-as-code detection beyond Dockerfile/docker-compose (no
  consumer needs terraform/k8s/helm yet). Deferred.
- Loading and executing a user `sverka.config.ts` to map its workflow into
  proposed checks. That requires executing user code and is tightly coupled
  to the SDK's Workflow→IR-Plan wiring; deferred to the SDK wave (09).
- Generating CI pipeline files (compiler packages).
- Resolving dependency vulnerabilities (`findings`/`checks`).

## Interfaces

```typescript
// src/index.ts — public exports

export { type Planner, type DiscoverOptions, type ProjectContext,
         type PlanProposal, type ProposedCheck, type LocalSignal,
         type LocalSignalType, type DetectedLanguage,
         type DetectedPackageManager, type MonorepoMarker,
         type ChangedFile, type DiscoveryExplanation } from "./planner.js";
export { createPlanner } from "./planner.js";
export { DiscoveryError, type DiscoveryErrorCode } from "./errors.js";
```

```typescript
// src/planner.ts

/**
 * Top-level entry point for discovery and plan synthesis.
 */
export interface Planner {
  /**
   * Discover project context from local signals. Pure: reads the filesystem
   * and git only; no network, no writes.
   */
  discover(options: DiscoverOptions): Promise<ProjectContext>;

  /**
   * Synthesize a default plan proposal from a discovered context.
   * Proposes checks based on detected languages and package managers.
   * Does not load or execute a user workflow (deferred to SDK wave).
   */
  plan(context: ProjectContext): Promise<PlanProposal>;
}

/**
 * Create a Planner. The git seam (`internal/git-cli.ts`) is mocked in tests
 * via `vi.mock`; it is not part of the public API.
 */
export function createPlanner(): Planner;

/**
 * Options controlling discovery behavior.
 */
export interface DiscoverOptions {
  /** Root directory of the project to inspect. Must exist. */
  root: string;
  /**
   * Git ref to diff against when computing changedFiles. If omitted,
   * changedFiles is empty and the explanation notes "no baseRef provided".
   * Must be a local ref (no network).
   */
  baseRef?: string;
  /** Maximum depth for filesystem traversal. Defaults to 10. */
  maxDepth?: number;
}

/**
 * The complete context of a project under analysis.
 */
export interface ProjectContext {
  /** Absolute path to the project root. */
  root: string;
  /** Git commit SHA at discovery time (HEAD). */
  commit: string;
  /** Whether the working tree has uncommitted changes. */
  dirty: boolean;
  /** Files that changed relative to baseRef (empty if baseRef omitted). */
  changedFiles: readonly ChangedFile[];
  /** Detected programming languages with evidence. */
  languages: readonly DetectedLanguage[];
  /** Detected package managers with evidence. */
  packageManagers: readonly DetectedPackageManager[];
  /** True when a Dockerfile or docker-compose file was detected. */
  hasContainerBuild: boolean;
  /** True when a CI definition was detected. */
  hasCiDefinition: boolean;
  /** Monorepo marker if a monorepo layout was detected, else null. */
  monorepo: MonorepoMarker | null;
  /** All local signals collected during discovery. */
  localSignals: readonly LocalSignal[];
  /** Human-readable explanation of how the context was assembled. */
  explanation: DiscoveryExplanation;
}

/**
 * A file that changed relative to baseRef.
 */
export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
}

/**
 * A detected programming language.
 */
export interface DetectedLanguage {
  name: string;
  confidence: number;
  /** File extensions that mapped to this language (e.g. [".ts", ".tsx"]). */
  evidence: string[];
  fileCount: number;
}

/**
 * A detected package manager.
 */
export interface DetectedPackageManager {
  name: "npm" | "yarn" | "pnpm" | "bun" | "pip" | "poetry" | "uv" |
        "pipenv" | "cargo" | "go" | "maven" | "gradle" | "composer" | "other";
  version: string | null;
  lockfile: string | null;
  evidence: string[];
}

// `name: "other"` is used when a lockfile is present but does not match any
// known package manager (e.g. a custom vendored lockfile).

/**
 * Marker indicating a monorepo layout.
 */
export interface MonorepoMarker {
  tool: "nx" | "turborepo" | "lerna" | "pnpm-workspace" | "bun-workspace" |
        "custom";
  workspaces: readonly string[];
  evidence: string[];
}

/**
 * A signal collected from the local filesystem or git.
 */
export interface LocalSignal {
  type: LocalSignalType;
  path: string;
  detail: string | null;
  confidence: number;
}

export type LocalSignalType =
  | "manifest"
  | "lockfile"
  | "dockerfile"
  | "docker-compose"
  | "ci-definition"
  | "monorepo-marker"
  | "git-metadata";

/**
 * A plan proposal synthesized from context.
 */
export interface PlanProposal {
  context: ProjectContext;
  checks: readonly ProposedCheck[];
  /** Always null in v1 (user workflow loading deferred to SDK wave). */
  workflowPath: string | null;
  notes: readonly string[];
}

/**
 * A check proposed by the planner.
 */
export interface ProposedCheck {
  id: string;
  checkId: string;
  reason: string;
  /** `${type}:${path}` of the LocalSignal that triggered this check, or null. */
  signalRef: string | null;
  priority: number;
}

/**
 * A human-readable explanation of discovery decisions.
 */
export interface DiscoveryExplanation {
  summary: string;
  /** Count of signals collected, per type. */
  signalCounts: Readonly<Record<LocalSignalType, number>>;
}
```

```typescript
// src/errors.ts

export class DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode;
  readonly cause: unknown;
  constructor(message: string, code: DiscoveryErrorCode, cause?: unknown) {
    super(message);
    this.name = "DiscoveryError";
    this.code = code;
    this.cause = cause;
  }
}

export type DiscoveryErrorCode =
  | "ROOT_NOT_FOUND"
  | "GIT_UNAVAILABLE"
  | "GIT_NOT_A_REPO"
  | "TRAVERSAL_FAILED";
```

```typescript
// src/internal/git-cli.ts (NOT exported — mockable seam)

export interface GitCli {
  /** Run a git command in root, return stdout. Throws on non-zero exit. */
  run(args: readonly string[], cwd: string): Promise<string>;
}

/** Default implementation: spawns `git`. */
export function createGitCli(): GitCli;
```

## Data models

### ProjectContext assembly

1. **Validate root.** If root does not exist → `ROOT_NOT_FOUND`. If `git` is
   not on PATH → `GIT_UNAVAILABLE`. If root is not inside a git repo →
   `GIT_NOT_A_REPO`.
2. **Enumerate files via git** (`git ls-files` for tracked, `git status
   --porcelain` for untracked). Git respects `.gitignore`, so no hand-rolled
   gitignore matching. `maxDepth` filters the result set.
3. **Collect local signals** by scanning the file list against detection
   rules (table below). Each match emits a `LocalSignal` with confidence.
4. **Aggregate signals** into `languages`, `packageManagers`,
   `hasContainerBuild`, `hasCiDefinition`, and `monorepo`.
5. **Collect git metadata** via `git rev-parse HEAD`, `git status --porcelain`
   (dirty), and `git diff --name-status <baseRef>..HEAD` when baseRef is
   provided.
6. **Assemble explanation**: a one-line summary plus `signalCounts`.

### Detection rules

| Signal type | Detection rule | Confidence |
|---|---|---|
| `manifest` | `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `composer.json` present | 1.0 |
| `lockfile` | `bun.lock`, `bun.lockb`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock`, `Cargo.lock`, `go.sum` present | 1.0 |
| `dockerfile` | file named `Dockerfile` or matching `*.Dockerfile` | 1.0 |
| `docker-compose` | `docker-compose.yml` or `docker-compose.yaml` | 1.0 |
| `ci-definition` | `.github/workflows/*.yml`, `.gitlab-ci.yml`, `.circleci/`, `azure-pipelines.yml`, `Jenkinsfile` | 1.0 |
| `monorepo-marker` | `nx.json`, `turbo.json`, `lerna.json`, `pnpm-workspace.yaml`, or root `package.json` with a `workspaces` field | 1.0 |
| `git-metadata` | `git rev-parse HEAD`, `git status --porcelain`, `git diff --name-status` | 1.0 |

### Language detection

Languages are inferred from file extensions of the enumerated files.
`fileCount` is the count of files of that language within traversal depth.
Confidence is `min(1.0, fileCount / 10)`.

### Package manager detection

Package managers are inferred from lockfile presence (table above) and, for
Node, from the `packageManager` field of `package.json` when present. `version`
is read from `packageManager` or the lockfile when determinable, else `null`.

### Monorepo detection

`nx.json` → `nx`; `turbo.json` → `turborepo`; `lerna.json` → `lerna`;
`pnpm-workspace.yaml` → `pnpm-workspace`; root `package.json` with
`workspaces` and no other marker → `custom` (or `bun-workspace` when
`packageManager` starts with `bun`). Workspace globs are resolved to the
workspace paths that exist on disk.

### Plan synthesis (default, no user workflow)

`plan(context)` proposes checks from detected languages and package managers:

| Detected | Proposed check (`checkId`) | Reason |
|---|---|---|
| TypeScript/JavaScript + npm/bun/yarn/pnpm | `typecheck`, `lint`, `test` | Node project defaults |
| Python + pip/poetry/uv | `lint`, `test` | Python project defaults |
| Rust + cargo | `fmt-check`, `clippy`, `test` | Rust project defaults |
| Go + go.mod | `vet`, `test` | Go project defaults |

Each proposed check gets a stable `id` (`prop-<sha256 of checkId+reason>`), a
`signalRef` pointing at the manifest/lockfile signal that triggered it (or
`null` for pure defaults), and `priority` 2. `notes` records which signals
drove selection and any skipped categories. When nothing is detected,
`checks` is empty and `notes` explains that no defaults applied.

## Error handling

- **`DiscoveryError`** is thrown for unrecoverable failures. Codes:
  - `ROOT_NOT_FOUND` — root directory does not exist.
  - `GIT_UNAVAILABLE` — git not installed / not on PATH.
  - `GIT_NOT_A_REPO` — root is not inside a git repository.
  - `TRAVERSAL_FAILED` — filesystem traversal hit a permission error.
- No remote, no credentials, no timeout codes in v1.
- All errors include a `cause` field (`unknown`, narrowed by consumers). No
  `any` types.

## Test plan

Tests live in `packages/planner/src/__tests__/` and run via `bun run test`
(vitest). The git seam (`GitCli`) is mocked in unit tests; a fixture tree is
built in a temp dir per test.

1. **Local signal detection:** manifest, lockfile, dockerfile,
   docker-compose, ci-definition, monorepo-marker signals are detected with
   correct type and confidence.
2. **Language detection:** file extensions map to correct languages;
   `fileCount` and `confidence = min(1, fileCount/10)` are correct.
3. **Package manager detection:** each lockfile maps to the correct package
   manager; `packageManager` field overrides lockfile inference; `version`
   is extracted when available, else `null`.
4. **Monorepo detection:** `nx.json` → `nx`; `pnpm-workspace.yaml` →
   `pnpm-workspace`; root `package.json` `workspaces` with no other marker →
   `custom` (or `bun-workspace` when `packageManager` starts with `bun`);
   workspace globs resolve to existing paths.
5. **Git metadata:** commit SHA, dirty state, and changed files (status only)
   are collected when `baseRef` is provided; `changedFiles` is empty and
   explanation notes it when `baseRef` is omitted.
6. **Explainability:** every signal increments `signalCounts`; `summary` is
   non-empty.
7. **Determinism:** identical fixture trees + identical git mock outputs
   produce byte-identical `ProjectContext` (no timestamps in v1).
8. **Plan synthesis:** a Node project proposes `typecheck`/`lint`/`test`;
   Python proposes `lint`/`test`; Rust proposes `fmt-check`/`clippy`/`test`;
   Go proposes `vet`/`test`; an empty context proposes no checks with an
   explanatory note; proposed check ids are stable and deterministic.
9. **Error cases:** `ROOT_NOT_FOUND` when root missing; `GIT_UNAVAILABLE`
   when git mock throws ENOENT; `GIT_NOT_A_REPO` when `git rev-parse`
   fails; `TRAVERSAL_FAILED` when a read throws EACCES.
10. **Side-effect freedom:** discover() does not write any file under root
    (assert no new files after run in a temp fixture).
