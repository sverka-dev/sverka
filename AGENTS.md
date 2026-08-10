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
- **Lint:** oxlint
- **Format:** Biome
- **Pre-commit:** Husky + lint-staged (biome format)

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
