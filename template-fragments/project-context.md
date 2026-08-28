# Project Context

## Project

Sverka is a composable workflow SDK, local CI runtime, and multi-target
compiler for software verification. Define checks once. Plan locally. Run
anywhere.

The project is a TypeScript native monorepo (nx + tsdown), built spec-first
(SDD), test-first (TDD), in waves.

The canonical product spec lives in `specs/` as a numbered tree. Engineering
docs live in `engdocs/`. The repo is at the city root.

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
  runtime-host/     # host process executor
  compiler-github/  # GitHub Actions compiler
  compiler-gitlab/  # GitLab CI compiler
  findings/         # normalization, fingerprints, baseline
  policy/           # policy evaluation
  cli/              # command-line interface
  checks/           # built-in check providers
  sdk/              # public TypeScript API
website/            # sverka.dev minimalistic site
specs/              # numbered spec tree (SDD)
engdocs/            # engineering docs (document-first)
```

## Commands

```bash
bun install          # install dependencies
bun run build        # build all packages (tsdown via nx)
bun run test         # run all tests (vitest via nx); NOTE: `bun test` runs Bun's built-in runner, not vitest
bun run lint         # lint all packages
bun run typecheck    # typecheck all packages
```

## Sverka wave plan

- **Wave 0:** Spec tree, monorepo scaffold, Gas City setup — DONE
- **Wave 1:** Core package — workflow graph, operations, outputs — DONE
- **Wave 2:** IR package — canonical plan schema and validation
- **Wave 3:** Runtime package — executor interfaces and scheduler
- **Wave 4:** Runtime-docker — Docker executor
- **Wave 5:** Runtime-host — host process executor
- **Wave 6:** Planner package — discovery and plan synthesis
- **Wave 7:** Findings package — normalization, fingerprints, baseline
- **Wave 8:** Policy package — policy evaluation
- **Wave 9:** SDK package — public TypeScript API
- **Wave 10:** CLI package — command-line interface
- **Wave 11:** Checks package — built-in check providers
- **Wave 12:** Compiler-github — GitHub Actions compiler
- **Wave 13:** Compiler-gitlab — GitLab CI compiler
- **Wave 14:** Website — sverka.dev minimalistic site
- **Wave 15:** Documentation — user docs, agentic docs

Each wave: architect designs -> builder implements (TDD) -> reviewer gates.

## Gas City

This project is orchestrated by Gas City. The mayor agent plans and dispatches
all work. Agents: mayor (orchestrator), architect (specs/design), builder
(implementation), reviewer (quality gate).

All work flows through the mayor. Use formulas in `formulas/` for multi-step
orchestration.

**Model:** All agents use `DEVIN_MODEL=glm-5-2` (GLM-5.2 High, free tier).
This is set in `city.toml` at the `[workspace]` env level. Do not override
this with a paid model.
