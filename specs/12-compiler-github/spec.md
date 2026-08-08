# Spec 12 — GitHub Actions Compiler

## Overview

The `compiler-github` package compiles a canonical Sverka plan (Plan IR)
into a GitHub Actions workflow YAML file. The canonical plan is the single
source of truth; GitHub Actions is a compilation target, not the source of
truth.

The initial implementation is a **thin wrapper**: the generated workflow
installs Sverka and runs `sverka execute .sverka/plan.json`. This keeps the
compiler trivial and ensures parity between local and CI execution from day
one. Later, the compiler will support **native job expansion** for checks
that benefit from native CI visibility (separate job pages, SARIF upload to
GitHub code scanning, artifact retention).

## Goals

1. Compile a canonical plan to a valid GitHub Actions workflow YAML.
2. Initial implementation: thin wrapper that runs `sverka execute
   .sverka/plan.json` in a single job.
3. Later: native job expansion for selected checks, producing one GitHub
   Actions job per check (or grouped check) for native CI visibility.
4. Map plan-level permissions to GitHub Actions `permissions` declarations.
5. Map plan secrets to GitHub Actions `secrets` references.
6. Map plan artifacts to GitHub Actions `actions/upload-artifact` steps.
7. Upload SARIF outputs to GitHub code scanning via `github/codeql-action`.
8. Produce deterministic, idempotent output: the same plan always compiles
   to the same YAML.
9. Validate the generated YAML against GitHub Actions schema constraints
   known to the compiler.

## Non-goals

- Replacing the local runtime. The compiler emits a workflow; execution
  still happens via Sverka.
- Supporting every GitHub Actions feature (matrix, dynamic includes,
  reusable workflows) in v1.
- Generating workflows that bypass Sverka entirely. Native expansion is an
  optimization, not a replacement.
- Hosting or running the workflow. The compiler only produces YAML.
- Managing GitHub repository settings, branch protection, or required
  status checks.

## Interfaces

```typescript
import type { Plan } from "@sverka/ir";

/**
 * Compiler configuration.
 */
export interface GithubCompilerConfig {
  /** Workflow name. Defaults to "Sverka". */
  readonly name?: string;
  /** Trigger events. Defaults to push and pull_request. */
  readonly on?: GithubTriggers;
  /** Runner image label, e.g. "ubuntu-latest". Defaults to "ubuntu-latest". */
  readonly runner?: string;
  /** Whether to use thin wrapper (true) or native expansion (false). */
  readonly mode?: "thin" | "native";
  /** Sverka version to install in the workflow. */
  readonly sverkaVersion?: string;
  /** Node version setup. */
  readonly nodeVersion?: string;
  /** Permissions granted to the GITHUB_TOKEN. */
  readonly permissions?: GithubPermissions;
  /** Secrets to reference in jobs. */
  readonly secrets?: readonly string[];
}

export interface GithubTriggers {
  readonly push?: readonly string[];
  readonly pullRequest?: readonly string[];
  readonly workflowDispatch?: boolean;
  readonly schedule?: readonly string[];
}

export interface GithubPermissions {
  readonly contents?: "read" | "write";
  readonly actions?: "read" | "write";
  readonly checks?: "read" | "write";
  readonly securityEvents?: "read" | "write";
  readonly idToken?: "read" | "write";
}

/**
 * Result of compilation.
 */
export interface GithubCompileResult {
  /** Generated workflow YAML string. */
  readonly yaml: string;
  /** Warnings emitted during compilation. */
  readonly warnings: readonly CompilerWarning[];
  /** Mode used: thin or native. */
  readonly mode: "thin" | "native";
}

export interface CompilerWarning {
  readonly code: GithubCompilerWarningCode;
  readonly message: string;
  readonly checkId?: string;
}

export type GithubCompilerWarningCode =
  | "UNSUPPORTED_CHECK_NATIVE"
  | "MISSING_SARIF_OUTPUT"
  | "PERMISSION_DOWNGRADED"
  | "SECRET_NOT_DECLARED";

/**
 * The compiler.
 */
export interface GithubCompiler {
  compile(plan: Plan, config?: GithubCompilerConfig): Promise<GithubCompileResult>;
}

/** Factory. */
export function createGithubCompiler(): GithubCompiler;
```

### Thin wrapper output

```yaml
name: Sverka
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
  security-events: write
jobs:
  sverka:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - run: bun install -g sverka@latest
      - run: sverka execute .sverka/plan.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: sverka-findings
          path: .sverka/output/
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: .sverka/output/results.sarif
```

### Native expansion output (later)

```yaml
jobs:
  eslint:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - run: bun install -g sverka@latest
      - run: sverka execute .sverka/plan.json --check eslint
      - uses: github/codeql-action/upload-sarif@v3
        if: always()
        with:
          sarif_file: .sverka/output/eslint.sarif
```

## Data models

### Compilation mode selection

| Condition                              | Mode   | Behavior                                   |
|----------------------------------------|--------|--------------------------------------------|
| Default                                | thin   | Single job runs `sverka execute`           |
| `config.mode === "native"`            | native | One job per check with `--check` flag      |
| Check not supported for native         | native | Falls back to thin for that check, warning |

### Permission mapping

| Plan permission      | GitHub Actions permission |
|----------------------|---------------------------|
| read-repo            | `contents: read`          |
| write-repo           | `contents: write`         |
| upload-sarif         | `security-events: write`  |
| read-actions         | `actions: read`           |
| oidc-token           | `id-token: write`         |

### Secret handling

Secrets declared in the plan are referenced as `${{ secrets.NAME }}` in
generated steps. The compiler does not validate that the secret exists in
the GitHub repository; it emits a `SECRET_NOT_DECLARED` warning if a secret
is referenced in the plan but not listed in `config.secrets`.

### Artifact mapping

| Plan artifact          | GitHub Actions step                          |
|------------------------|----------------------------------------------|
| findings directory     | `actions/upload-artifact@v4`                 |
| SARIF report           | `github/codeql-action/upload-sarif@v3`       |
| JUnit report           | `actions/upload-artifact@v4` (optional)      |

## Error handling

```typescript
export class GithubCompilerError extends Error {
  constructor(
    message: string,
    readonly code: GithubCompilerErrorCode,
  ) {
    super(message);
    this.name = "GithubCompilerError";
  }
}

export type GithubCompilerErrorCode =
  | "INVALID_PLAN"
  | "UNSUPPORTED_TRIGGER"
  | "YAML_GENERATION_FAILED"
  | "NATIVE_EXPANSION_UNAVAILABLE";
```

- `INVALID_PLAN`: the plan fails IR validation. Compilation aborts.
- `UNSUPPORTED_TRIGGER`: a trigger in the config is not supported. Abort.
- `YAML_GENERATION_FAILED`: the YAML serializer fails. Abort.
- `NATIVE_EXPANSION_UNAVAILABLE`: `mode: "native"` requested but the check
  does not support native expansion. The compiler falls back to thin for
  that check and emits a warning, unless the entire plan requires native and
  none support it, in which case it throws.

Warnings are non-fatal and returned in `GithubCompileResult.warnings`.

## Test plan

- Unit tests for thin wrapper compilation: given a minimal plan, the
  generated YAML contains the expected steps, permissions, and triggers.
- Unit tests for permission mapping: each plan permission maps to the
  correct GitHub Actions permission.
- Unit tests for secret references: declared secrets appear as
  `${{ secrets.NAME }}` in output.
- Unit tests for artifact upload: findings directory and SARIF upload steps
  are present.
- Unit tests for native expansion: one job per check, each with `--check`
  flag and SARIF upload.
- Unit tests for fallback: unsupported native check falls back to thin with
  a warning.
- Determinism test: compiling the same plan twice produces identical YAML.
- Snapshot tests for representative plans.
- Tests run via `bun test`.
- No `any` types; all test inputs use typed `Plan` objects.
```