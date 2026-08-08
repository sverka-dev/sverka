# Sverka — Agent Instructions

## Project

Sverka is a composable workflow SDK, local CI runtime, and multi-target
compiler for software verification. Define checks once. Plan locally. Run
anywhere.

## Tech stack

- **Language:** TypeScript (strict, ESM)
- **Runtime:** Node.js 24+, Bun
- **Package manager:** Bun (workspaces)
- **Monorepo:** Nx
- **Build:** tsdown
- **Test:** Vitest
- **Lint:** ESLint
- **Format:** Prettier

## Structure

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
website/            # sverka.dev minimalistic site
specs/              # numbered spec tree (SDD)
engdocs/            # engineering docs (document-first)
```

## Conventions

- **SDD:** Specs are written first, in `specs/`, numbered and structured.
- **TDD:** Tests are written before implementation. Always.
- **Document-first:** Engineering docs in `engdocs/` before code.
- **Waves:** Work is organized in waves. Each wave: architect -> builder -> reviewer.
- **No `any`:** Use `unknown` and narrow. Strict TypeScript.
- **Public API:** Everything public is exported from `src/index.ts`.
- **Error handling:** Custom error classes per package.

## Commands

```bash
bun install          # install dependencies
bun run build        # build all packages (tsdown via nx)
bun test             # run all tests (vitest)
bun run lint         # lint all packages
bun run typecheck    # typecheck all packages
```

## Gas City

This project is orchestrated by Gas City. The mayor agent plans and dispatches
all work. Agents: mayor (orchestrator), architect (specs/design), builder
(implementation), reviewer (quality gate).

All work flows through the mayor. Use formulas in `formulas/` for multi-step
orchestration.
