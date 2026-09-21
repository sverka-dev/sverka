# Contributor Guide

## Getting started

1. Clone the repository.
2. Install dependencies: `bun install`
3. Build all packages: `bun run build`
4. Run tests: `bun run test` (vitest — `bun test` runs Bun's built-in runner, not vitest)
5. Run linter: `bun run lint`
6. Run typecheck: `bun run typecheck`

## Tech stack

- **Language:** TypeScript (strict, ESM)
- **Runtime:** Node.js 24+, Bun
- **Package manager:** Bun (workspaces)
- **Monorepo:** Nx
- **Build:** tsdown
- **Test:** Vitest
- **Lint:** ESLint
- **Format:** Prettier

## Package layout

```text
packages/
  workflow/         # cdk + core + ir — constructs, graph model, canonical plan
  runtime/          # engine-native + runtime-host + runtime-docker — scheduler, executors
  compiler/         # github + gitlab + temporal + dagger + inngest + drone targets + plugin framework
  verification/     # findings + policy + checks + sarif pipeline
  sdk/              # public TypeScript API, including planner
  cli/              # command-line interface (includes mcp-server)
  plugin-mcp/       # MCP plugin: load external MCP servers as tools
  reporter/         # report generation
  storage/          # persistence layer
  ui/               # local web dashboard for SARIF findings
  sarif-viewer-tui/ # terminal SARIF viewer
  sarif-viewer-web/ # standalone HTML report generator for SARIF
  playground/       # browser sandbox for building and running check pipelines
  arena/            # conformance arena
  benchmark/        # performance benchmarking
website/            # sverka.dev minimalistic site
specs/              # numbered spec tree (SDD)
engdocs/            # engineering docs (document-first)
```

## Current product focus

Sverka is a **local-first check runner for AI agents**. The core value
proposition: one `sverka run --format json` replaces N tool-call
round-trips. CI compilation is optional, not the headline. SaaS/browser
execution is deferred.

Key features in active development:
- `sverka run --format json` — per-step results (stepId, status, durationMs,
  error, stdout, stderr, exitCode)
- `sverka init --detect` — generate config from detected project checks
- `sverka validate` — validate Definition Graph; warns on unknown props
- `dependsOn` — string step IDs; validate catches typos
- Dependency inference from data flow (output ref → auto-dep)
- SARIF findings via `outputs: { "x.sarif": { type: "artifact", fromStdout: true } }`
  + `sverka run --evaluate`
- Shell steps run with **cwd = project root**; `runtime.workingDir` is
  repo-relative. `exportArtifact`/`importArtifact` paths are repo-relative
  (GitLab `artifacts:paths` semantics). Per-step scratch lives under
  `.sverka/workspace/<stepId>` — use `$SVERKA_OUTPUT_DIR` for step outputs.

## Known issues

- **`sverka validate` warns on unknown props.** Step/Entry/Pipeline
  constructors attach `sverka:warning` metadata for props not in the known
  set; `loadProjectGraph` returns them and `validate`/`run` print them.
  (`dependencies:` instead of `dependsOn:` now warns instead of silently
  dropping the wiring.)
- **Startup overhead.** `sverka run` has historically taken ~11s before the
  first command starts (config load + tsx register); recent work lazy-loads
  the reporter and MCP SDK to cut this significantly.

## Gas City

This project is orchestrated by Gas City. The mayor agent plans and dispatches
all work. Agents: mayor (orchestrator), architect (specs/design), builder
(implementation), reviewer (quality gate).

All work flows through the mayor. Use formulas in `formulas/` for multi-step
orchestration.

**Model:** All agents use `DEVIN_MODEL=glm-5-2` (GLM-5.2 High, free tier).
This is set in `city.toml` at the `[workspace]` env level. Do not override
this with a paid model.

## Workflow

Sverka is built in waves. Each wave goes through:

1. **Architect** designs the spec and implementation plan.
2. **Builder** implements from the spec using TDD (tests first).
3. **Reviewer** gates quality (tests, build, lint, typecheck, spec compliance).

## Conventions

- **SDD:** Specs are written first in `specs/`.
- **TDD:** Tests are written before implementation.
- **Document-first:** Engineering docs in `engdocs/` before code.
- **No `any`:** Use `unknown` and narrow. Strict TypeScript.
- **Public API:** Everything public is exported from `src/index.ts`.
- **Error handling:** Custom error classes per package.
- **ESM only:** All packages use ES modules.

## Commit style

- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Scope: `feat(core): add pipeline builder`
- Breaking changes: `feat(core)!:` with BREAKING CHANGE footer.

## Branch naming

- `wave-NN-<short-description>` for wave work
- `fix-<issue-number>-<short-description>` for fixes
