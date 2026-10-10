# Sverka — Agent Instructions

## Project

Sverka is a local-first workflow runtime for code-defined checks. Define
checks once in TypeScript. Run locally with one command. Compile to CI
optionally. AI-agent friendly — one command replaces dozens of tool-call
round-trips.

## Devin plugin

This repo is a Devin plugin. `devin plugins install sverka-dev/sverka`
exposes the `sverka` skill (`/sverka:sverka`) — a thin wrapper that drives
the `sverka` CLI for check detection, config authoring, `sverka plan`,
`sverka run`, and `sverka validate`. All mechanics live in the CLI; the
skill carries usage policy only.

## Working on sverka itself

See `engdocs/contributing/guide.md` for tech stack, monorepo layout,
conventions (SDD, TDD, waves), build commands, and Gas City orchestration.

## Build & Test

```bash
bun install          # install dependencies
bun run build        # build all packages (tsdown via nx)
bun run test         # run all tests (vitest via nx)
bun run lint         # lint all packages
bun run typecheck    # typecheck all packages
```

## Conventions & Patterns

- **SDD:** Specs are written first, in `specs/`, numbered and structured.
- **TDD:** Tests are written before implementation.
- **Document-first:** Engineering docs in `engdocs/` before code.
- **No `any`:** Use `unknown` and narrow. Strict TypeScript.
- **Public API:** Everything public is exported from `src/index.ts`.
- **Error handling:** Custom error classes per package.
- **No secrets in argv or echoed args** — credentials travel via env,
  stdin, or credential helpers; never interpolate tokens into args or
  error text.
- **Shared filesystem paths need ownership** — shared caches, clones, and
  temp dirs get a lock, a lease, or a content-addressed name.
- **Composite keys get a canonical form** — no bare string concat
  (`m`+`ab` collides with `ma`+`b`); use a tuple, JSON, or hash.
- **Parse before comparing** — never lexical ordering for structured
  values (ISO timestamps with offsets, versions).
- **Invalid input fails loud** — throw, report, or reject; a silent drop
  turns a restriction into a no-op.

## Current Product Focus

Sverka is a **local-first check runner for AI agents**. Core value: one
`sverka run --format json` replaces N tool-call round-trips. CI compilation
is optional. SaaS/browser execution is deferred.

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

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

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

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
