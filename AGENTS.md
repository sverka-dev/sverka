# Sverka — Agent Instructions

## Project

Sverka is a local-first workflow runtime for code-defined checks. Define
checks once in TypeScript. Run locally with one command. Compile to CI
optionally. AI-agent friendly — one command replaces dozens of tool-call
round-trips.

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
  workflow/         # cdk + core + ir — constructs, graph model, canonical plan
  runtime/          # engine-native + runtime-host + runtime-docker — scheduler, executors
  compiler/        # github + gitlab + temporal + dagger + inngest + drone targets + plugin framework
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

## Conventions

- **SDD:** Specs are written first, in `specs/`, numbered and structured.
- **TDD:** Tests are written before implementation. Always.
- **Document-first:** Engineering docs in `engdocs/` before code.
- **Waves:** Work is organized in waves. Each wave: architect -> builder -> reviewer.
- **No `any`:** Use `unknown` and narrow. Strict TypeScript.
- **Public API:** Everything public is exported from `src/index.ts`.
- **Error handling:** Custom error classes per package.

## Current Product Focus

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

## Known Issues

- **`sverka validate` warns on unknown props.** Step/Entry/Pipeline
  constructors attach `sverka:warning` metadata for props not in the known
  set; `loadProjectGraph` returns them and `validate`/`run` print them.
  (`dependencies:` instead of `dependsOn:` now warns instead of silently
  dropping the wiring.)
- ~~**~20 empty package directories**~~ Removed: only stale `dist/` +
  `node_modules/` residue remained. Real code lives as subdirs inside
  `workflow`/`runtime`/`compiler`/`sdk`/`verification`.
- ~~**v0 compilers coexist with v1.**~~ Deleted: `compiler-github/` +
  `compiler-gitlab/` (Plan-based `compileGithubWorkflow`/`compileGitlabCi`,
  unused). `github/target.ts` + `gitlab/target.ts` (DefinitionGraph) remain.

## Critical Audit Findings (2026-02 session) — RESOLVED

- ~~**Findings/policy/SARIF pipeline disconnected.**~~ Fixed: `exportStdout`
  op + `fromStdout` output declaration writes captured stdout into the
  artifact dir (even on step failure). `collectFindings` now errors when the
  artifact dir is missing instead of a false `verdict:pass`. `ruff check`
  resolves with `--output-format=sarif` + SARIF output declaration.
- ~~**AI agent JSON output too shallow.**~~ Fixed: step results include
  `stdout`, `stderr`, `exitCode` (truncated at 10KB per stream).
- ~~**CDK-style `dependsOn` Step objects.**~~ Reverted: `dependsOn` takes
  string IDs only; `sverka validate` catches typos.
- **11s startup overhead.** `sverka run` takes 11s before first command starts
  (config load + tsx register). 10-line bash script does same parallelism in 1.4s.
- ~~**Tests test structure not behavior.**~~ Integration test now exercises the
  real SARIF pipeline (step emits SARIF on stdout → artifact → collectFindings
  → policy gate) instead of a manually placed fixture + invalid `dependencies`
  prop.
- ~~**Dead compilers.**~~ Deleted: temporal/dagger/inngest/drone (36 files) +
  orphaned `internal/` + `__tests__/helpers/`.

## Commands

```bash
bun install          # install dependencies
bun run build        # build all packages (tsdown via nx)
bun run test         # run all tests (vitest via nx); NOTE: `bun test` runs Bun's built-in runner, not vitest
bun run lint         # lint all packages
bun run typecheck    # typecheck all packages
```

## Gas City

This project is orchestrated by Gas City. The mayor agent plans and dispatches
all work. Agents: mayor (orchestrator), architect (specs/design), builder
(implementation), reviewer (quality gate).

All work flows through the mayor. Use formulas in `formulas/` for multi-step
orchestration.

**Model:** All agents use `DEVIN_MODEL=glm-5-2` (GLM-5.2 High, free tier).
This is set in `city.toml` at the `[workspace]` env level. Do not override
this with a paid model.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:970c3bf2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
