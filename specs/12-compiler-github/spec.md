# Spec 12 — GitHub Actions Compiler

## Overview

The `compiler-github` package compiles a canonical Sverka plan (Plan IR) into
a GitHub Actions workflow YAML file. The canonical plan is the single source
of truth; GitHub Actions is a compilation target.

The v1 implementation is a **thin wrapper** (per ADR-004): the generated
workflow installs Sverka and runs `sverka execute .sverka/plan.json` in a
single job. Native job expansion is a later optimization, not in scope.

## Goals

1. Compile a canonical `Plan` to a valid GitHub Actions workflow YAML.
2. Thin wrapper: single job runs `sverka execute .sverka/plan.json`.
3. Map plan credentials (`CredentialDeclaration.envVar`) to GitHub Actions
   `env` entries referencing `${{ secrets.NAME }}`.
4. Produce deterministic, idempotent output: same plan + config → same YAML.

## Non-goals

- Native job expansion (one job per check). Later optimization (ADR-004).
- SARIF upload to GitHub code scanning. `sverka execute` does not produce
  SARIF in v1; add when it does.
- Replacing the local runtime. The compiler emits YAML; execution is Sverka.
- Hosting or running the workflow. The compiler only produces YAML.
- Managing GitHub repository settings, branch protection, or required checks.
- Validating the generated YAML against a GitHub Actions JSON schema. The
  output is valid by construction.

## Interfaces

```typescript
import type { Plan } from "@sverka/ir";

/** Compiler configuration. All fields optional; sensible defaults apply. */
export interface GithubCompilerConfig {
  /** Workflow name. Defaults to "Sverka". */
  readonly name?: string;
  /** Trigger events. Defaults to push on main + pull_request. */
  readonly on?: GithubTriggers;
  /** Runner image label. Defaults to "ubuntu-latest". */
  readonly runner?: string;
  /** Sverka version to install. Defaults to "latest". */
  readonly sverkaVersion?: string;
  /** Node version for actions/setup-node. Defaults to "24". */
  readonly nodeVersion?: string;
  /** Permissions for the GITHUB_TOKEN. Defaults to { contents: "read" }. */
  readonly permissions?: GithubPermissions;
}

export interface GithubTriggers {
  readonly push?: readonly string[];
  readonly pullRequest?: readonly string[];
  readonly workflowDispatch?: boolean;
}

export interface GithubPermissions {
  readonly contents?: "read" | "write";
  readonly actions?: "read" | "write";
  readonly checks?: "read" | "write";
  readonly securityEvents?: "read" | "write";
  readonly idToken?: "read" | "write";
}

/**
 * Compile a Plan to a GitHub Actions workflow YAML string.
 *
 * Pure and synchronous: no I/O, no side effects. The same plan + config
 * always produces the same YAML.
 */
export function compileGithubWorkflow(
  plan: Plan,
  config?: GithubCompilerConfig,
): string;
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
jobs:
  sverka:
    runs-on: ubuntu-latest
    env:
      API_TOKEN: ${{ secrets.API_TOKEN }}
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
          name: sverka-output
          path: .sverka/output/
```

## Data models

### Credential mapping

Credentials are collected from `plan.operations[].credentials[]`. Each
`CredentialDeclaration` has an `envVar` field. The compiler collects the
unique set of `envVar` values across all operations and emits a job-level
`env:` block mapping each to `${{ secrets.<ENV_VAR> }}`. If no operations
declare credentials, the `env:` block is omitted.

### Default config

| Field           | Default                                    |
|-----------------|--------------------------------------------|
| `name`          | `"Sverka"`                                 |
| `on`            | `{ push: ["main"], pullRequest: [] }`      |
| `runner`        | `"ubuntu-latest"`                          |
| `sverkaVersion` | `"latest"`                                 |
| `nodeVersion`   | `"24"`                                     |
| `permissions`   | `{ contents: "read" }`                     |

### YAML serialization

Uses the `yaml` library (eemeli/yaml, already in lockfile). The workflow
object is constructed deterministically; `stringify` produces deterministic
output for deterministic input.

## Error handling

No custom error class. The compiler is a pure function operating on a
validated `Plan`. If the `yaml` serializer fails (should not happen for
well-formed input), the native `Error` propagates.

## Test plan

1. **Minimal plan, default config:** YAML contains `name: Sverka`, push on
   main, pull_request, `permissions: contents: read`, `runs-on:
   ubuntu-latest`, checkout, setup-node (node 24), `bun install -g
   sverka@latest`, `sverka execute .sverka/plan.json`, upload-artifact.
2. **Custom config:** custom name, runner, sverkaVersion, nodeVersion
   reflected in YAML.
3. **Custom triggers:** `workflowDispatch: true` present; custom push
   branches present; `pullRequest` with explicit branches.
4. **Credentials:** plan with operations declaring credentials → `env:`
   block with `${{ secrets.VAR }}` for each unique `envVar`.
5. **No credentials:** plan with no credentials → no `env:` block.
6. **Custom permissions:** config permissions reflected in YAML.
7. **Determinism:** same plan + config compiled twice → identical YAML.
8. **Empty operations:** plan with empty `operations` array → valid YAML
   (workflow still runs `sverka execute`, which handles empty plans).
9. Tests run via `vitest` (not `bun test`).
10. No `any` types; all test inputs use typed `Plan` objects.
