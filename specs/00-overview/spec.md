# Spec 00 — Sverka Overview and Architecture

## Overview

Sverka is a composable workflow SDK, local CI runtime, and multi-target
compiler for software verification. It allows a project to define reusable
workflows as TypeScript code, execute them locally using Docker or Podman,
plan without executing, and compile to GitHub Actions, GitLab CI, and other
targets.

## Goals

1. TypeScript-first composable workflow API.
2. Run verification workflows 100% locally without requiring a CI provider.
3. Execute checks in Docker, Podman, host processes, or remote APIs.
4. Support automatic project discovery when no configuration exists.
5. Generate a verification plan before execution.
6. Compile one workflow to multiple outer runners.
7. Reuse the same workflow definition locally and in CI.
8. Normalize findings from heterogeneous tools into one model.
9. Support deterministic, reproducible execution using locked images and inputs.
10. Maximize local parallelism, caching, and incremental execution.

## Non-goals (v1)

- Replacing GitHub Actions or GitLab CI as hosted platforms.
- Implementing a full distributed durable workflow service.
- Supporting arbitrary deployment orchestration.
- Providing a hosted SaaS control plane.
- Implementing every scanner directly inside Sverka.

## Architecture

```
                 ┌─────────────────────┐
                 │ Workflow SDK / DSL  │
                 └──────────┬──────────┘
                            │
                 ┌──────────▼──────────┐
                 │ Discovery + Planner  │
                 └──────────┬──────────┘
                            │
                 ┌──────────▼──────────┐
                 │ Canonical Plan IR   │
                 └──────┬───────┬───────┘
                        │       │
        ┌───────────────▼─┐   ┌─▼────────────────┐
        │ Local Executors  │   │ Target Compilers │
        ├──────────────────┤   ├─────────────────┤
        │ Docker           │   │ GitHub Actions  │
        │ Podman           │   │ GitLab CI       │
        │ Host             │   │ Dagger          │
        │ Remote API       │   │ Earthly         │
        └────────┬─────────┘   └────────┬────────┘
                 │                      │
                 └──────────┬───────────┘
                            │
                 ┌──────────▼──────────┐
                 │ Findings + Verdict  │
                 └─────────────────────┘
```

## Package structure

```
packages/
  core/             # workflow graph, operations, outputs
  planner/          # discovery and plan synthesis
  ir/               # canonical plan schema and validation
  runtime/          # executor interfaces and scheduler
  runtime-docker/   # Docker executor
  runtime-podman/   # Podman executor
  runtime-host/     # host process executor
  runtime-remote/   # GitHub/GitLab/SonarCloud API checks
  compiler-github/  # GitHub Actions compiler
  compiler-gitlab/  # GitLab CI compiler
  compiler-earthly/ # optional Earthly compiler
  findings/         # normalization, fingerprints, baseline
  policy/           # policy evaluation
  cli/              # command-line interface
  checks/           # built-in check providers
  sdk/              # public TypeScript API
```

## Key architectural decisions

1. The canonical source is TypeScript workflow code plus resolved Plan IR.
2. GitHub Actions and GitLab CI are compilation targets, not the source of truth.
3. The local executor is a first-class runtime, not merely a CI emulator.
4. Docker and Podman are execution backends, not the public workflow abstraction.
5. Operations are lazy and composable; planning must not perform side effects.
6. Every external check is represented as a declared operation.
7. Findings are normalized independently from tool-specific output.
8. The first CI compiler should emit a thin wrapper around the Sverka runner.
9. Native job generation is an optimization added after the wrapper model works.
10. The system must be useful with zero project configuration, but support full
    CDK-style customization.

## Tech stack

- **Language:** TypeScript (strict, ESM)
- **Runtime:** Node.js 24+, Bun
- **Package manager:** Bun (workspaces)
- **Monorepo:** Nx
- **Build:** tsdown
- **Test:** Vitest
- **Lint:** ESLint
- **Format:** Prettier

## Test plan

- Each package has its own test suite in `src/__tests__/`.
- Tests run via `bun test`.
- Integration tests that require Docker are marked and skippable.
- All public API surfaces must have test coverage.
