# Spec 13 — GitLab CI Compiler

## Overview

The `compiler-gitlab` package compiles a canonical Sverka plan (Plan IR)
into a GitLab CI YAML configuration (`.gitlab-ci.yml`). The canonical plan
is the single source of truth; GitLab CI is a compilation target.

The initial implementation is a **thin wrapper**: the generated
configuration installs Sverka and runs `sverka execute .sverka/plan.json`
in a single job. This ensures parity between local and CI execution. Later,
the compiler will support **native job expansion** for checks that benefit
from native CI visibility (separate job entries in the GitLab pipeline
view, artifact reports, SARIF-compatible output).

## Goals

1. Compile a canonical plan to a valid `.gitlab-ci.yml`.
2. Initial implementation: thin wrapper that runs `sverka execute
   .sverka/plan.json` in a single job.
3. Later: native job expansion for selected checks, producing one GitLab CI
   job per check (or grouped check) for native pipeline visibility.
4. Map plan stages to GitLab CI `stages` declarations.
5. Map plan artifacts to GitLab CI `artifacts` and `reports` declarations.
6. Map plan rules (branch, merge request) to GitLab CI `rules` arrays.
7. Map plan variables to GitLab CI `variables` declarations.
8. Produce deterministic, idempotent output: the same plan always compiles
   to the same YAML.
9. Validate the generated YAML against GitLab CI schema constraints known
   to the compiler.

## Non-goals

- Replacing the local runtime. The compiler emits a configuration;
  execution still happens via Sverka.
- Supporting every GitLab CI feature (dynamic child pipelines, trigger
  jobs, resource groups, needs chaining) in v1.
- Generating configurations that bypass Sverka entirely. Native expansion
  is an optimization, not a replacement.
- Hosting or running the pipeline. The compiler only produces YAML.
- Managing GitLab project settings, merge request approvals, or protected
  branches.

## Interfaces

```typescript
import type { Plan } from "@sverka/ir";

/**
 * Compiler configuration.
 */
export interface GitlabCompilerConfig {
  /** Whether to use thin wrapper (true) or native expansion (false). */
  readonly mode?: "thin" | "native";
  /** Sverka version to install in the job. */
  readonly sverkaVersion?: string;
  /** Base image for the job, e.g. "node:24". */
  readonly image?: string;
  /** Global variables to declare. */
  readonly variables?: Readonly<Record<string, string>>;
  /** Custom stages. If omitted, a default stage list is generated. */
  readonly stages?: readonly string[];
  /** Rules for when the pipeline should run. */
  readonly rules?: readonly GitlabRule[];
}

export interface GitlabRule {
  readonly if?: string;
  readonly when?: "on_success" | "on_failure" | "never" | "always" | "manual";
  readonly changes?: readonly string[];
  readonly exists?: readonly string[];
}

/**
 * Result of compilation.
 */
export interface GitlabCompileResult {
  /** Generated .gitlab-ci.yml string. */
  readonly yaml: string;
  /** Warnings emitted during compilation. */
  readonly warnings: readonly CompilerWarning[];
  /** Mode used: thin or native. */
  readonly mode: "thin" | "native";
}

export interface CompilerWarning {
  readonly code: GitlabCompilerWarningCode;
  readonly message: string;
  readonly checkId?: string;
}

export type GitlabCompilerWarningCode =
  | "UNSUPPORTED_CHECK_NATIVE"
  | "MISSING_ARTIFACT_REPORT"
  | "RULE_FALLBACK"
  | "STAGE_COLLISION";

/**
 * The compiler.
 */
export interface GitlabCompiler {
  compile(plan: Plan, config?: GitlabCompilerConfig): Promise<GitlabCompileResult>;
}

/** Factory. */
export function createGitlabCompiler(): GitlabCompiler;
```

### Thin wrapper output

```yaml
stages:
  - verify

variables:
  SVERKA_VERSION: "latest"

sverka:
  stage: verify
  image: node:24
  rules:
    - if: $CI_PIPELINE_SOURCE == "push"
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  before_script:
    - bun install -g sverka@$SVERKA_VERSION
  script:
    - sverka execute .sverka/plan.json
  artifacts:
    when: always
    paths:
      - .sverka/output/
    reports:
      codequality: .sverka/output/codequality.json
      junit: .sverka/output/junit.xml
```

### Native expansion output (later)

```yaml
stages:
  - lint
  - test
  - security

eslint:
  stage: lint
  image: node:24
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  before_script:
    - bun install -g sverka@$SVERKA_VERSION
  script:
    - sverka execute .sverka/plan.json --check eslint
  artifacts:
    when: always
    reports:
      codequality: .sverka/output/eslint-codequality.json

trivy:
  stage: security
  image: node:24
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  before_script:
    - bun install -g sverka@$SVERKA_VERSION
  script:
    - sverka execute .sverka/plan.json --check trivy
  artifacts:
    when: always
    reports:
      container_scanning: .sverka/output/trivy-scanning.json
```

## Data models

### Compilation mode selection

| Condition                              | Mode   | Behavior                                      |
|----------------------------------------|--------|-----------------------------------------------|
| Default                                | thin   | Single job runs `sverka execute`              |
| `config.mode === "native"`            | native | One job per check with `--check` flag         |
| Check not supported for native         | native | Falls back to thin for that check, warning    |

### Stage mapping

| Check category         | GitLab CI stage |
|------------------------|-----------------|
| build                  | `build`         |
| lint                   | `lint`          |
| test                   | `test`          |
| typecheck              | `test`          |
| securityScan           | `security`      |
| dependencyAudit        | `security`      |

When `config.stages` is provided, the compiler uses those stages. Otherwise
it derives stages from the check categories in the plan. If two checks map
to the same stage, they run in parallel within that stage.

### Artifact and report mapping

| Plan artifact          | GitLab CI report type          |
|------------------------|--------------------------------|
| SARIF report           | (converted) `codequality`      |
| Code quality JSON      | `codequality`                  |
| JUnit XML              | `junit`                        |
| Container scanning     | `container_scanning`           |
| Dependency scanning    | `dependency_scanning`          |
| Secret detection       | `secret_detection`             |
| Generic findings dir   | `artifacts.paths`              |

GitLab CI does not natively consume SARIF. The compiler emits a
`MISSING_ARTIFACT_REPORT` warning if a check produces SARIF but no
GitLab-compatible report is configured. The runtime is responsible for
converting SARIF to GitLab's code quality JSON format.

### Rules mapping

| Plan rule condition              | GitLab CI rule                          |
|----------------------------------|-----------------------------------------|
| Run on push to main              | `if: $CI_COMMIT_BRANCH == "main"`       |
| Run on merge request             | `if: $CI_PIPELINE_SOURCE == "merge_request_event"` |
| Run on schedule                  | `if: $CI_PIPELINE_SOURCE == "schedule"` |
| Changes to specific paths        | `changes: [...]`                        |

If no rules are provided, the compiler defaults to running on push and
merge request events.

### Variables mapping

Plan-level variables are emitted as global `variables:` entries. Job-level
variables (in native mode) are emitted under each job's `variables:` key.
Secret variables are referenced as `$VARIABLE_NAME` and the compiler
assumes they are defined in the GitLab project CI/CD settings.

## Error handling

```typescript
export class GitlabCompilerError extends Error {
  constructor(
    message: string,
    readonly code: GitlabCompilerErrorCode,
  ) {
    super(message);
    this.name = "GitlabCompilerError";
  }
}

export type GitlabCompilerErrorCode =
  | "INVALID_PLAN"
  | "UNSUPPORTED_RULE"
  | "YAML_GENERATION_FAILED"
  | "NATIVE_EXPANSION_UNAVAILABLE";
```

- `INVALID_PLAN`: the plan fails IR validation. Compilation aborts.
- `UNSUPPORTED_RULE`: a rule condition in the config is not supported.
  Abort.
- `YAML_GENERATION_FAILED`: the YAML serializer fails. Abort.
- `NATIVE_EXPANSION_UNAVAILABLE`: `mode: "native"` requested but the check
  does not support native expansion. The compiler falls back to thin for
  that check and emits a warning, unless the entire plan requires native and
  none support it, in which case it throws.

Warnings are non-fatal and returned in `GitlabCompileResult.warnings`.

## Test plan

- Unit tests for thin wrapper compilation: given a minimal plan, the
  generated YAML contains the expected job, stages, rules, and artifacts.
- Unit tests for stage mapping: each check category maps to the correct
  stage.
- Unit tests for artifact and report mapping: code quality, JUnit, and
  container scanning reports are present when the plan declares them.
- Unit tests for rules mapping: push, merge request, schedule, and changes
  rules produce correct `rules:` arrays.
- Unit tests for variables: global and job-level variables appear in
  output.
- Unit tests for native expansion: one job per check, each with `--check`
  flag and appropriate report.
- Unit tests for fallback: unsupported native check falls back to thin with
  a warning.
- Determinism test: compiling the same plan twice produces identical YAML.
- Snapshot tests for representative plans.
- Tests run via `bun test`.
- No `any` types; all test inputs use typed `Plan` objects.
