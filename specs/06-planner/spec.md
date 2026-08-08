# Spec 06 — Planner Package: Discovery and Plan Synthesis

## Overview

The `planner` package is responsible for discovering project context and
synthesizing a verification plan. It inspects the local working tree, reads
manifests and configuration files, queries remote providers for metadata, and
assembles a `ProjectContext` that downstream packages (IR, runtime, compilers)
consume. Discovery must be deterministic, side-effect free, and explainable:
every signal that contributes to the plan is recorded so users can audit why a
particular check was selected or skipped.

The planner does not execute checks. It only gathers signals and produces a
plan proposal. Execution is the responsibility of the runtime packages.

## Goals

1. Discover project context from local filesystem signals with zero
   configuration.
2. Discover project context from remote provider signals (GitHub, GitLab, cloud
   credentials) when available.
3. Produce a `ProjectContext` model that fully describes the project under
   analysis.
4. Record every discovery signal with its source and confidence so the plan is
   explainable and auditable.
5. Synthesize a plan proposal from discovered context plus any user-supplied
   workflow definition.
6. Support monorepo layouts with multiple workspaces and mixed languages.
7. Detect CI definitions, Dockerfiles, Terraform, and infrastructure-as-code to
   inform check selection.
8. Detect package managers, languages, and frameworks to select appropriate
   built-in checks.
9. Remain deterministic: identical inputs produce identical `ProjectContext`
   outputs.
10. Remain side-effect free: discovery must not mutate the working tree, write
    files, or make state-changing API calls.

## Non-goals (v1)

- Executing checks or running tools during discovery.
- Mutating project files or configuration.
- Implementing full static analysis of source code.
- Caching remote API responses persistently (in-memory cache only within a
  single discovery run).
- Resolving dependency vulnerabilities (that is the responsibility of the
  `findings` and `checks` packages).
- Generating CI pipeline files (that is the responsibility of compiler
  packages).

## Interfaces

```typescript
/**
 * Top-level entry point for discovery and plan synthesis.
 */
export interface Planner {
  /**
   * Discover project context from local and remote signals.
   *
   * @param options Discovery options.
   * @returns A resolved ProjectContext with all signals recorded.
   */
  discover(options: DiscoverOptions): Promise<ProjectContext>;

  /**
   * Synthesize a plan proposal from a project context and optional
   * user-supplied workflow definition.
   *
   * @param context The discovered project context.
   * @param workflowPath Optional path to a sverka.config.ts file.
   * @returns A plan proposal ready for IR validation.
   */
  plan(context: ProjectContext, workflowPath?: string): Promise<PlanProposal>;
}

/**
 * Options controlling discovery behavior.
 */
export interface DiscoverOptions {
  /** Root directory of the project to inspect. */
  root: string;
  /** Git commit SHA to anchor discovery. Defaults to HEAD. */
  commit?: string;
  /** Whether to query remote providers. Defaults to true when credentials
   *  are available. */
  remote?: boolean;
  /** Whether to include remote signals that require network access. */
  remoteSignals?: RemoteSignalType[];
  /** Maximum depth for filesystem traversal. Defaults to 10. */
  maxDepth?: number;
  /** Paths to exclude from discovery (gitignore patterns are always
   *  respected). */
  exclude?: string[];
  /** Provider credentials for remote discovery. */
  credentials?: ProviderCredentials;
}

/**
 * The complete context of a project under analysis.
 */
export interface ProjectContext {
  /** Absolute path to the project root. */
  root: string;
  /** Git commit SHA at discovery time. */
  commit: string;
  /** Whether the working tree has uncommitted changes. */
  dirty: boolean;
  /** Files that changed relative to the base ref. */
  changedFiles: ChangedFile[];
  /** Detected programming languages with evidence. */
  languages: DetectedLanguage[];
  /** Detected frameworks with evidence. */
  frameworks: DetectedFramework[];
  /** Detected package managers with evidence. */
  packageManagers: DetectedPackageManager[];
  /** Detected infrastructure-as-code and deployment signals. */
  infrastructure: InfrastructureSignal[];
  /** Remote provider metadata (GitHub, GitLab, etc.). */
  providers: ProviderMetadata[];
  /** Credentials available for remote discovery. */
  credentials: ProviderCredentials;
  /** All local signals collected during discovery. */
  localSignals: LocalSignal[];
  /** All remote signals collected during discovery. */
  remoteSignals: RemoteSignal[];
  /** Monorepo markers if a monorepo layout was detected. */
  monorepo: MonorepoMarker | null;
  /** Human-readable explanation of how the context was assembled. */
  explanation: DiscoveryExplanation;
}

/**
 * A file that changed relative to a base ref.
 */
export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
}

/**
 * A detected programming language.
 */
export interface DetectedLanguage {
  name: string;
  confidence: number;
  evidence: string[];
  fileCount: number;
}

/**
 * A detected framework.
 */
export interface DetectedFramework {
  name: string;
  version: string | null;
  confidence: number;
  evidence: string[];
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

/**
 * An infrastructure-as-code or deployment signal.
 */
export interface InfrastructureSignal {
  type: "dockerfile" | "docker-compose" | "terraform" | "pulumi" |
        "kubernetes" | "helm" | "ansible" | "cloudformation" | "serverless";
  path: string;
  detail: string | null;
}

/**
 * Metadata about a remote provider.
 */
export interface ProviderMetadata {
  provider: "github" | "gitlab" | "bitbucket" | "sonarcloud" | "other";
  owner: string;
  repo: string;
  url: string;
  defaultBranch: string;
  isPrivate: boolean;
}

/**
 * Credentials for remote provider access.
 */
export interface ProviderCredentials {
  github?: { token: string; apiUrl?: string };
  gitlab?: { token: string; apiUrl?: string };
  sonarcloud?: { token: string; organization: string };
  cloud?: CloudCredential[];
}

/**
 * Cloud credential detected in the environment.
 */
export interface CloudCredential {
  provider: "aws" | "gcp" | "azure";
  profile: string | null;
  region: string | null;
  detectedFrom: string;
}

/**
 * A signal collected from the local filesystem.
 */
export interface LocalSignal {
  type: LocalSignalType;
  path: string;
  detail: string | null;
  confidence: number;
}

export type LocalSignalType =
  | "file"
  | "manifest"
  | "dockerfile"
  | "docker-compose"
  | "terraform"
  | "git-metadata"
  | "ci-definition"
  | "monorepo-marker"
  | "lockfile"
  | "config-file";

/**
 * A signal collected from a remote provider.
 */
export interface RemoteSignal {
  type: RemoteSignalType;
  provider: string;
  detail: string | null;
  confidence: number;
  fetchedAt: string;
}

export type RemoteSignalType =
  | "github-metadata"
  | "gitlab-metadata"
  | "code-scanning-findings"
  | "dependabot-alerts"
  | "sonarcloud-findings"
  | "pr-metadata"
  | "cloud-credentials";

/**
 * Marker indicating a monorepo layout.
 */
export interface MonorepoMarker {
  tool: "nx" | "turborepo" | "lerna" | "pnpm-workspace" | "bun-workspace" |
        "rush" | "bazel" | "custom";
  workspaces: string[];
  evidence: string[];
}

/**
 * A plan proposal synthesized from context.
 */
export interface PlanProposal {
  context: ProjectContext;
  checks: ProposedCheck[];
  workflowPath: string | null;
  notes: string[];
}

/**
 * A check proposed by the planner.
 */
export interface ProposedCheck {
  id: string;
  checkId: string;
  reason: string;
  signalRef: string;
  priority: number;
}

/**
 * A human-readable explanation of discovery decisions.
 */
export interface DiscoveryExplanation {
  summary: string;
  steps: DiscoveryStep[];
}

/**
 * A single step in the discovery explanation.
 */
export interface DiscoveryStep {
  step: string;
  input: string;
  output: string;
  rationale: string;
}

/**
 * A signal provider that contributes local or remote signals.
 */
export interface SignalProvider {
  readonly name: string;
  readonly type: "local" | "remote";
  discover(options: DiscoverOptions): Promise<LocalSignal[] | RemoteSignal[]>;
}

/**
 * Error thrown when discovery fails.
 */
export class DiscoveryError extends Error {
  readonly code: string;
  readonly cause: unknown;
  constructor(message: string, code: string, cause?: unknown) {
    super(message);
    this.name = "DiscoveryError";
    this.code = code;
    this.cause = cause;
  }
}
```

## Data models

### ProjectContext assembly

1. **Local discovery runs first.** Local signal providers are invoked in
   parallel. Each returns zero or more `LocalSignal` entries with a confidence
   score (0.0–1.0).
2. **Signals are aggregated** into `languages`, `frameworks`,
   `packageManagers`, `infrastructure`, and `monorepo` by correlating signals
   against known detection rules.
3. **Remote discovery runs second** (when enabled and credentials are
   available). Remote signal providers are invoked in parallel with a
   configurable timeout. Failures are recorded as signals with `confidence: 0`
   and do not abort discovery.
4. **Git metadata** is always collected: current commit, dirty state, and
   changed files relative to the base ref (default: merge-base with default
   branch).
5. **Explanation** is assembled from an ordered list of `DiscoveryStep`
   entries, one per signal provider invocation, recording input, output, and
   rationale.

### Detection rules

| Signal type | Detection rule | Confidence |
|---|---|---|
| `manifest` | Presence of `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `composer.json` | 1.0 |
| `dockerfile` | File named `Dockerfile` or matching `*.Dockerfile` | 1.0 |
| `docker-compose` | File named `docker-compose.yml` or `docker-compose.yaml` | 1.0 |
| `terraform` | Files matching `*.tf` or `*.tf.json` | 1.0 |
| `ci-definition` | Files under `.github/workflows/`, `.gitlab-ci.yml`, `.circleci/`, `azure-pipelines.yml`, `Jenkinsfile` | 1.0 |
| `monorepo-marker` | Presence of `nx.json`, `turbo.json`, `lerna.json`, `pnpm-workspace.yaml`, root `package.json` with `workspaces` field | 1.0 |
| `lockfile` | `bun.lock`, `bun.lockb`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `poetry.lock`, `Cargo.lock`, `go.sum` | 1.0 |
| `git-metadata` | `git rev-parse HEAD`, `git status --porcelain`, `git diff --name-only` | 1.0 |
| `github-metadata` | API call to `/repos/{owner}/{repo}` | 0.9 |
| `code-scanning-findings` | API call to GitHub code scanning alerts | 0.9 |
| `dependabot-alerts` | API call to GitHub Dependabot alerts | 0.9 |
| `sonarcloud-findings` | API call to SonarCloud issues endpoint | 0.9 |
| `cloud-credentials` | Environment variables `AWS_*`, `GOOGLE_APPLICATION_CREDENTIALS`, `AZURE_*` or config files | 0.7 |

### Language detection

Languages are inferred from file extensions and manifest files. The
`fileCount` field records how many files of that language were found within
the traversal depth. Confidence is `min(1.0, fileCount / 10)`.

### Framework detection

Frameworks are inferred from dependency entries in manifest files. For
example, `package.json` dependencies containing `react` produce a
`DetectedFramework` with `name: "react"` and `version` from the dependency
range. Confidence is 0.9 for direct dependencies, 0.6 for transitive.

## Error handling

- **`DiscoveryError`** is thrown for unrecoverable failures (missing root
  directory, git not available, invalid credentials format). The `code` field
  identifies the failure category:
  - `ROOT_NOT_FOUND` — the root directory does not exist.
  - `GIT_UNAVAILABLE` — git is not installed or not on PATH.
  - `GIT_NOT_A_REPO` — the root is not inside a git repository.
  - `INVALID_CREDENTIALS` — credentials are malformed.
  - `REMOTE_TIMEOUT` — a remote provider exceeded the timeout (wrapped, not
    thrown; recorded as a signal).
  - `TRAVERSAL_FAILED` — filesystem traversal encountered a permission error.
- **Remote signal failures are non-fatal.** If a remote provider returns an
  error or times out, a `RemoteSignal` with `confidence: 0` and the error
  message in `detail` is recorded. Discovery continues with remaining
  providers.
- **Partial discovery is valid.** If some local signal providers fail, their
  absence is noted in the explanation but discovery does not abort.
- All errors include a `cause` field for chaining underlying errors.
- No `any` types are used; `cause` is typed as `unknown` and narrowed by
  consumers.

## Test plan

Tests live in `packages/planner/src/__tests__/` and run via `bun test`.

1. **Local signal detection:**
   - Manifest files (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`)
     are detected with correct type and confidence.
   - Dockerfiles and docker-compose files are detected.
   - Terraform files are detected.
   - CI definitions under `.github/workflows/` and `.gitlab-ci.yml` are
     detected.
   - Lockfiles are detected and mapped to the correct package manager.
2. **Language detection:**
   - File extensions map to correct languages.
   - `fileCount` and confidence are computed correctly.
3. **Framework detection:**
   - Direct dependencies produce confidence 0.9.
   - Transitive dependencies produce confidence 0.6.
   - Version is extracted from the dependency range.
4. **Monorepo detection:**
   - `nx.json` produces `tool: "nx"`.
   - `pnpm-workspace.yaml` produces `tool: "pnpm-workspace"`.
   - Root `package.json` with `workspaces` produces `tool: "custom"` when no
     other monorepo tool is detected.
   - Workspace globs are resolved to workspace paths.
5. **Git metadata:**
   - Commit SHA, dirty state, and changed files are collected.
   - Changed files include correct status and line counts.
6. **Remote signals (mocked):**
   - GitHub metadata is fetched when a token is provided.
   - Code scanning findings are fetched and recorded.
   - Dependabot alerts are fetched and recorded.
   - SonarCloud findings are fetched when configured.
   - Remote failures are recorded as signals with `confidence: 0` and do not
     abort discovery.
   - Remote discovery is skipped when `remote: false`.
7. **Cloud credentials:**
   - AWS credentials detected from environment variables.
   - GCP credentials detected from `GOOGLE_APPLICATION_CREDENTIALS`.
   - Azure credentials detected from environment variables.
8. **Explainability:**
   - Every signal has a corresponding `DiscoveryStep` in the explanation.
   - Steps are ordered chronologically.
   - Each step records input, output, and rationale.
9. **Determinism:**
   - Identical inputs produce identical `ProjectContext` outputs (excluding
     `fetchedAt` timestamps on remote signals).
10. **Plan synthesis:**
    - A `PlanProposal` is produced from a `ProjectContext`.
    - Proposed checks reference the signals that triggered them.
    - A user-supplied `sverka.config.ts` overrides auto-detected checks.
11. **Error cases:**
    - `ROOT_NOT_FOUND` when root does not exist.
    - `GIT_NOT_A_REPO` when root is not a git repository.
    - `INVALID_CREDENTIALS` when credentials are malformed.
    - Filesystem permission errors are caught and recorded.
