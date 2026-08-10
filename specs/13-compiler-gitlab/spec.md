# Spec 13 — GitLab CI Compiler

## Overview

The `compiler-gitlab` package compiles a canonical Sverka plan (Plan IR) into
a GitLab CI YAML configuration (`.gitlab-ci.yml`). The canonical plan is the
single source of truth; GitLab CI is a compilation target.

The v1 implementation is a **thin wrapper** (per ADR-004): the generated
configuration installs Sverka and runs `sverka execute .sverka/plan.json` in
a single job. Native job expansion is a later optimization, not in scope.

## Goals

1. Compile a canonical `Plan` to a valid `.gitlab-ci.yml`.
2. Thin wrapper: single job runs `sverka execute .sverka/plan.json`.
3. Map config rules to GitLab CI `rules:` arrays (when the pipeline runs).
4. Produce deterministic, idempotent output: same plan + config → same YAML.

## Non-goals

- Native job expansion (one job per check). Later optimization (ADR-004).
- Credential mapping. GitLab CI/CD variables defined in project settings are
  auto-injected into jobs as `$VAR` — no YAML declaration needed, unlike
  GitHub Actions which requires explicit `env:` mapping to expose secrets.
- Replacing the local runtime. The compiler emits YAML; execution is Sverka.
- Hosting or running the pipeline. The compiler only produces YAML.
- Managing GitLab project settings, merge request approvals, or protected
  branches.
- Validating the generated YAML against a GitLab CI schema. The output is
  valid by construction.
- SARIF/code-quality report mapping. `sverka execute` does not produce
  SARIF in v1; GitLab report types are add when it does.

## Interfaces

```typescript
import type { Plan } from "@sverka/ir";

/** Compiler configuration. All fields optional; sensible defaults apply. */
export interface GitlabCompilerConfig {
  /** Base image for the job. Defaults to "node:24". */
  readonly image?: string;
  /** Sverka version to install. Defaults to "latest". */
  readonly sverkaVersion?: string;
  /** Rules for when the pipeline should run. Defaults to push + merge request. */
  readonly rules?: readonly GitlabRule[];
}

export interface GitlabRule {
  readonly if?: string;
  readonly when?: "on_success" | "never" | "always" | "manual";
}

/**
 * Compile a Plan to a GitLab CI YAML string.
 *
 * Pure and synchronous: no I/O, no side effects. The same plan + config
 * always produces the same YAML.
 */
export function compileGitlabCi(
  plan: Plan,
  config?: GitlabCompilerConfig,
): string;
```

### Thin wrapper output

```yaml
stages:
  - verify

sverka:
  stage: verify
  image: node:24
  rules:
    - if: $CI_PIPELINE_SOURCE == "push"
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  before_script:
    - bun install -g sverka@latest
  script:
    - sverka execute .sverka/plan.json
  artifacts:
    when: always
    paths:
      - .sverka/output/
```

## Data models

### Default config

| Field           | Default                                                              |
|-----------------|----------------------------------------------------------------------|
| `image`         | `"node:24"`                                                          |
| `sverkaVersion` | `"latest"`                                                           |
| `rules`         | `[{ if: '$CI_PIPELINE_SOURCE == "push"' }, { if: '$CI_PIPELINE_SOURCE == "merge_request_event"' }]` |

### YAML serialization

Uses the `yaml` library (eemeli/yaml, already in lockfile). The pipeline
object is constructed deterministically; `stringify` produces deterministic
output for deterministic input.

## Error handling

No custom error class. The compiler is a pure function operating on a
validated `Plan`. If the `yaml` serializer fails (should not happen for
well-formed input), the native `Error` propagates.

## Test plan

1. **Minimal plan, default config:** YAML contains `stages: [verify]`,
   `sverka` job with `stage: verify`, `image: node:24`, default rules
   (push + merge_request_event), `before_script: bun install -g
   sverka@latest`, `script: sverka execute .sverka/plan.json`,
   `artifacts: when: always, paths: [.sverka/output/]`.
2. **Custom config:** custom image and sverkaVersion reflected in YAML.
3. **Custom rules:** config with custom `if` conditions and `when` values
   reflected in `rules:` array.
4. **Determinism:** same plan + config compiled twice → identical YAML.
5. **Empty operations:** plan with empty `operations` array → valid YAML
   (job still runs `sverka execute`, which handles empty plans).
6. Tests run via `vitest` (not `bun test`).
7. No `any` types; all test inputs use typed `Plan` objects.
